import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Data, Layout } from 'plotly.js'
import type {
  BifurcationAxis,
  BifurcationDiagram,
  ClvRenderStyle,
  ComplexValue,
  ContinuationObject,
  ContinuationPoint,
  EquilibriumEigenvectorRenderStyle,
  EquilibriumObject,
  LimitCycleOrigin,
  OrbitObject,
  Scene,
  System,
  SystemConfig,
  TreeNode,
} from '../system/types'
import { DEFAULT_RENDER } from '../system/model'
import { defaultClvIndices, resolveClvColors, resolveClvRender } from '../system/clv'
import {
  defaultEquilibriumEigenvectorIndices,
  isRealEigenvalue,
  resolveEquilibriumEigenvectorColors,
  resolveEquilibriumEigenspaceIndices,
  resolveEquilibriumEigenvectorRender,
} from '../system/equilibriumEigenvectors'
import { PlotlyViewport } from '../viewports/plotly/PlotlyViewport'
import { resolvePlotlyBackgroundColor } from '../viewports/plotly/plotlyTheme'
import type {
  BranchContinuationRequest,
  BranchExtensionRequest,
  EquilibriumContinuationRequest,
  LimitCycleCreateRequest,
  EquilibriumSolveRequest,
  FoldCurveContinuationRequest,
  HopfCurveContinuationRequest,
  OrbitCovariantLyapunovRequest,
  OrbitLyapunovRequest,
  OrbitRunRequest,
  LimitCycleHopfContinuationRequest,
  LimitCycleOrbitContinuationRequest,
  LimitCyclePDContinuationRequest,
} from '../state/appState'
import { validateSystemConfig } from '../state/systemValidation'
import {
  buildSortedArrayOrder,
  extractHopfOmega,
  ensureBranchIndices,
  formatBifurcationLabel,
  getBranchParams,
  normalizeEigenvalueArray,
} from '../system/continuation'
import { isCliSafeName, toCliSafeName } from '../utils/naming'

type InspectorDetailsPanelProps = {
  system: System
  selectedNodeId: string | null
  view: 'selection' | 'system'
  theme: 'light' | 'dark'
  onRename: (id: string, name: string) => void
  onToggleVisibility: (id: string) => void
  onUpdateRender: (id: string, render: Partial<TreeNode['render']>) => void
  onUpdateScene: (id: string, update: Partial<Omit<Scene, 'id' | 'name'>>) => void
  onUpdateBifurcationDiagram: (
    id: string,
    update: Partial<Omit<BifurcationDiagram, 'id' | 'name'>>
  ) => void
  onUpdateSystem: (system: SystemConfig) => Promise<void>
  onValidateSystem: (system: SystemConfig, opts?: { signal?: AbortSignal }) => Promise<{
    ok: boolean
    equationErrors: Array<string | null>
    message?: string
  }>
  onRunOrbit: (request: OrbitRunRequest) => Promise<void>
  onComputeLyapunovExponents: (request: OrbitLyapunovRequest) => Promise<void>
  onComputeCovariantLyapunovVectors: (request: OrbitCovariantLyapunovRequest) => Promise<void>
  onSolveEquilibrium: (request: EquilibriumSolveRequest) => Promise<void>
  onCreateLimitCycle: (request: LimitCycleCreateRequest) => Promise<void>
  onCreateEquilibriumBranch: (request: EquilibriumContinuationRequest) => Promise<void>
  onCreateBranchFromPoint: (request: BranchContinuationRequest) => Promise<void>
  onExtendBranch: (request: BranchExtensionRequest) => Promise<void>
  onCreateFoldCurveFromPoint: (request: FoldCurveContinuationRequest) => Promise<void>
  onCreateHopfCurveFromPoint: (request: HopfCurveContinuationRequest) => Promise<void>
  onCreateLimitCycleFromHopf: (request: LimitCycleHopfContinuationRequest) => Promise<void>
  onCreateLimitCycleFromOrbit: (request: LimitCycleOrbitContinuationRequest) => Promise<void>
  onCreateLimitCycleFromPD: (request: LimitCyclePDContinuationRequest) => Promise<void>
}

type SystemDraft = {
  name: string
  type: 'flow' | 'map'
  solver: string
  varNames: string[]
  paramNames: string[]
  params: string[]
  equations: string[]
}

type OrbitRunDraft = {
  initialState: string[]
  duration: string
  dt: string
}

type LyapunovDraft = {
  transient: string
  qrStride: string
}

type CovariantLyapunovDraft = {
  transient: string
  forward: string
  backward: string
  qrStride: string
}

type EquilibriumSolveDraft = {
  initialGuess: string[]
  maxSteps: string
  dampingFactor: string
}

type LimitCycleDraft = {
  name: string
  period: string
  state: string[]
  ntst: string
  ncol: string
  parameterName: string
}

type LimitCycleFromOrbitDraft = {
  limitCycleName: string
  branchName: string
  parameterName: string
  tolerance: string
  ntst: string
  ncol: string
  stepSize: string
  maxSteps: string
  minStepSize: string
  maxStepSize: string
  correctorSteps: string
  correctorTolerance: string
  stepTolerance: string
  forward: boolean
}

type LimitCycleFromHopfDraft = {
  limitCycleName: string
  branchName: string
  parameterName: string
  amplitude: string
  ntst: string
  ncol: string
  stepSize: string
  maxSteps: string
  minStepSize: string
  maxStepSize: string
  correctorSteps: string
  correctorTolerance: string
  stepTolerance: string
  forward: boolean
}

type LimitCycleFromPDDraft = {
  limitCycleName: string
  branchName: string
  amplitude: string
  ncol: string
  stepSize: string
  maxSteps: string
  minStepSize: string
  maxStepSize: string
  correctorSteps: string
  correctorTolerance: string
  stepTolerance: string
  forward: boolean
}

type ContinuationDraft = {
  name: string
  parameterName: string
  stepSize: string
  maxSteps: string
  minStepSize: string
  maxStepSize: string
  correctorSteps: string
  correctorTolerance: string
  stepTolerance: string
  forward: boolean
}

type Codim1CurveDraft = {
  name: string
  param2Name: string
  stepSize: string
  maxSteps: string
  minStepSize: string
  maxStepSize: string
  correctorSteps: string
  correctorTolerance: string
  stepTolerance: string
  forward: boolean
}

type BranchEntry = {
  id: string
  name: string
  type: string
  points: number
  visible: boolean
}

const FLOW_SOLVERS = ['rk4', 'tsit5']
const MAP_SOLVERS = ['discrete']
const ORBIT_PREVIEW_PAGE_SIZE = 10

function nextName(prefix: string, existing: string[]) {
  const base = toCliSafeName(prefix)
  let index = 1
  let name = `${base}_${index}`
  while (existing.includes(name)) {
    index += 1
    name = `${base}_${index}`
  }
  return name
}

function adjustArray<T>(values: T[], targetLength: number, fill: () => T): T[] {
  if (values.length === targetLength) return values
  if (values.length > targetLength) return values.slice(0, targetLength)
  return [...values, ...Array.from({ length: targetLength - values.length }, fill)]
}

function formatAxisValue(axis: BifurcationAxis | null): string {
  return axis ? `${axis.kind}:${axis.name}` : ''
}

function parseAxisValue(value: string): BifurcationAxis | null {
  if (!value) return null
  const [kind, ...rest] = value.split(':')
  if (kind !== 'parameter' && kind !== 'state') return null
  const name = rest.join(':')
  if (!name) return null
  return { kind, name }
}

function formatAxisLabel(kind: BifurcationAxis['kind'], name: string): string {
  return `${kind === 'parameter' ? 'Parameter' : 'State space variable'}: ${name}`
}

type InspectorMetricRow = {
  label: string
  value: ReactNode
}

function InspectorMetrics({ rows }: { rows: InspectorMetricRow[] }) {
  return (
    <div className="inspector-metrics">
      {rows.map((row, index) => (
        <div className="inspector-metrics__row" key={`${row.label}-${index}`}>
          <span className="inspector-metrics__label">{row.label}</span>
          <span className="inspector-metrics__value">{row.value}</span>
        </div>
      ))}
    </div>
  )
}

function InspectorDisclosure({
  title,
  defaultOpen = false,
  children,
  testId,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
  testId?: string
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <details
      className="inspector-disclosure"
      open={open}
      onToggle={(event) =>
        setOpen((event.currentTarget as HTMLDetailsElement).open)
      }
    >
      <summary className="inspector-disclosure__summary" data-testid={testId}>
        {title}
      </summary>
      <div className="inspector-disclosure__content">{children}</div>
    </details>
  )
}

function formatNumber(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return 'n/a'
  return value.toPrecision(digits)
}

function formatFixed(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return 'n/a'
  return value.toFixed(digits)
}

function formatScientific(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return 'n/a'
  return value.toExponential(digits)
}

function formatComplexValue(value: ComplexValue): string {
  const real = formatFixed(value.re, 4)
  const imag = formatFixed(Math.abs(value.im), 4)
  const sign = value.im >= 0 ? '+' : '-'
  return `${real} ${sign} ${imag}i`
}

function formatPolarValue(value: ComplexValue, digits = 6): string {
  const radius = Math.hypot(value.re, value.im)
  const theta = Math.atan2(value.im, value.re)
  return `r=${formatNumber(radius, digits)}, theta=${formatNumber(theta, digits)} rad`
}

function formatNumberSafe(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'NaN'
  return formatNumber(value)
}

function formatBranchType(branch: ContinuationObject): string {
  return branch.branchType.replace('_', ' ')
}

function summarizeEigenvalues(point: ContinuationPoint, branchType?: string): string {
  const eigenvalues = normalizeEigenvalueArray(point.eigenvalues)
  const label = branchType === 'limit_cycle' ? 'Multipliers' : 'Eigenvalues'
  if (eigenvalues.length === 0) return `${label}: []`
  const formatted = eigenvalues
    .slice(0, 3)
    .map((ev) => `${formatNumberSafe(ev.re)}+${formatNumberSafe(ev.im)}i`)
  const suffix = eigenvalues.length > 3 ? ' …' : ''
  return `${label}: ${formatted.join(', ')}${suffix}`
}

function buildEigenvaluePlot(
  eigenvalues: ComplexValue[] | null | undefined,
  plotlyBackground: string,
  options?: { showRadiusLines?: boolean }
) {
  if (!eigenvalues || eigenvalues.length === 0) return null
  const x = eigenvalues.map((value) => value.re)
  const y = eigenvalues.map((value) => value.im)
  const finiteX = x.filter((value) => Number.isFinite(value))
  const finiteY = y.filter((value) => Number.isFinite(value))
  const safeX = finiteX.length > 0 ? finiteX : [0]
  const safeY = finiteY.length > 0 ? finiteY : [0]
  const minX = Math.min(...safeX, 0)
  const maxX = Math.max(...safeX, 0)
  const minY = Math.min(...safeY, 0)
  const maxY = Math.max(...safeY, 0)
  const spanX = maxX - minX
  const spanY = maxY - minY
  const span = Math.max(spanX, spanY) || 1
  const padding = span * 0.15
  const halfSpan = span / 2 + padding
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const rangeX: [number, number] = [centerX - halfSpan, centerX + halfSpan]
  const rangeY: [number, number] = [centerY - halfSpan, centerY + halfSpan]
  const radiusLines: Data[] =
    options?.showRadiusLines
      ? eigenvalues
          .filter((value) => Number.isFinite(value.re) && Number.isFinite(value.im))
          .map((value) => ({
            x: [0, value.re],
            y: [0, value.im],
            mode: 'lines',
            type: 'scatter',
            line: { color: 'rgba(120,120,120,0.35)', width: 1 },
            hoverinfo: 'skip',
            showlegend: false,
          }))
      : []
  const data: Data[] = [
    ...radiusLines,
    {
      x,
      y,
      mode: 'markers',
      type: 'scatter',
      name: 'Eigenvalues',
      marker: {
        color: 'var(--accent)',
        size: 8,
        line: { color: 'var(--panel-border)', width: 1 },
      },
      hovertemplate: 'Re %{x:.4f}<br>Im %{y:.4f}<extra></extra>',
    },
  ]
  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 36, r: 16, t: 8, b: 32 },
    paper_bgcolor: plotlyBackground,
    plot_bgcolor: plotlyBackground,
    showlegend: false,
    dragmode: 'pan',
    xaxis: {
      title: { text: 'Real part', font: { size: 11, color: 'var(--text)' } },
      zerolinecolor: 'rgba(120,120,120,0.3)',
      gridcolor: 'rgba(120,120,120,0.15)',
      tickfont: { size: 10, color: 'var(--text-muted)' },
      range: rangeX,
    },
    yaxis: {
      title: { text: 'Imaginary part', font: { size: 11, color: 'var(--text)' } },
      zerolinecolor: 'rgba(120,120,120,0.3)',
      gridcolor: 'rgba(120,120,120,0.15)',
      tickfont: { size: 10, color: 'var(--text-muted)' },
      scaleanchor: 'x',
      scaleratio: 1,
      range: rangeY,
    },
    annotations: [
      {
        x: rangeX[1],
        y: 0,
        xref: 'x',
        yref: 'y',
        text: 'Re',
        showarrow: false,
        xanchor: 'right',
        yanchor: 'bottom',
        xshift: -6,
        yshift: 6,
        font: { size: 10, color: 'var(--text-muted)' },
      },
      {
        x: 0,
        y: rangeY[1],
        xref: 'x',
        yref: 'y',
        text: 'Im',
        showarrow: false,
        xanchor: 'left',
        yanchor: 'top',
        xshift: 6,
        yshift: -6,
        font: { size: 10, color: 'var(--text-muted)' },
      },
    ],
  }
  return { data, layout }
}

function formatLimitCycleOrigin(origin: LimitCycleOrigin): string {
  if (origin.type === 'orbit') {
    return `Orbit ${origin.orbitName}`
  }
  if (origin.type === 'hopf') {
    return `Hopf point ${origin.pointIndex} on ${origin.equilibriumBranchName} (${origin.equilibriumObjectName})`
  }
  if (origin.type === 'pd') {
    return `Period doubling ${origin.pointIndex} on ${origin.sourceBranchName} (${origin.sourceLimitCycleObjectName})`
  }
  return 'Unknown'
}

// Matches the CLI Kaplan-Yorke dimension estimate for Lyapunov exponents.
function kaplanYorkeDimension(exponents: number[]): number | null {
  if (exponents.length === 0) return null
  const sorted = [...exponents].sort((a, b) => b - a)
  let partial = 0

  for (let i = 0; i < sorted.length; i += 1) {
    const lambda = sorted[i]
    const newSum = partial + lambda
    if (newSum >= 0) {
      partial = newSum
      if (i === sorted.length - 1) {
        return sorted.length
      }
      continue
    }

    if (Math.abs(lambda) < Number.EPSILON) {
      return i
    }
    return i + partial / Math.abs(lambda)
  }

  return sorted.length
}

function makeOrbitRunDraft(system: SystemConfig, orbit?: OrbitObject): OrbitRunDraft {
  const defaultDuration = system.type === 'map' ? 1000 : 100
  const defaultDt = system.type === 'map' ? 1 : 0.01
  const hasData = Boolean(orbit && orbit.data.length > 0)
  const initialState = hasData
    ? orbit!.data[0].slice(1).map((value) => value.toString())
    : system.varNames.map(() => '0')
  const duration = hasData ? orbit!.t_end - orbit!.t_start : defaultDuration
  return {
    initialState: adjustArray(initialState, system.varNames.length, () => '0'),
    duration: (duration > 0 ? duration : defaultDuration).toString(),
    dt: (orbit?.dt ?? defaultDt).toString(),
  }
}

function makeLyapunovDraft(): LyapunovDraft {
  return {
    transient: '0',
    qrStride: '1',
  }
}

function makeCovariantLyapunovDraft(): CovariantLyapunovDraft {
  return {
    transient: '0',
    forward: '0',
    backward: '0',
    qrStride: '1',
  }
}

function makeEquilibriumSolveDraft(
  system: SystemConfig,
  equilibrium?: EquilibriumObject
): EquilibriumSolveDraft {
  const defaultGuess =
    equilibrium?.lastSolverParams?.initialGuess ??
    equilibrium?.solution?.state ??
    system.varNames.map(() => 0)
  const defaultMaxSteps = equilibrium?.lastSolverParams?.maxSteps ?? 25
  const defaultDamping = equilibrium?.lastSolverParams?.dampingFactor ?? 1
  return {
    initialGuess: adjustArray(
      defaultGuess.map((value) => value.toString()),
      system.varNames.length,
      () => '0'
    ),
    maxSteps: defaultMaxSteps.toString(),
    dampingFactor: defaultDamping.toString(),
  }
}

function makeLimitCycleDraft(system: SystemConfig, orbit?: OrbitObject): LimitCycleDraft {
  const hasData = Boolean(orbit && orbit.data.length > 0)
  const lastRow = hasData ? orbit!.data[orbit!.data.length - 1] : null
  const state = lastRow ? lastRow.slice(1).map((value) => value.toString()) : []
  const period = hasData ? orbit!.t_end - orbit!.t_start : 1
  return {
    name: '',
    period: (period > 0 ? period : 1).toString(),
    state: adjustArray(state, system.varNames.length, () => '0'),
    ntst: '50',
    ncol: '4',
    parameterName: system.paramNames[0] ?? '',
  }
}

function makeLimitCycleFromOrbitDraft(system: SystemConfig): LimitCycleFromOrbitDraft {
  return {
    limitCycleName: '',
    branchName: '',
    parameterName: system.paramNames[0] ?? '',
    tolerance: '0.1',
    ntst: '20',
    ncol: '4',
    stepSize: '0.01',
    maxSteps: '50',
    minStepSize: '1e-5',
    maxStepSize: '0.1',
    correctorSteps: '10',
    correctorTolerance: '1e-6',
    stepTolerance: '1e-6',
    forward: true,
  }
}

function makeLimitCycleFromHopfDraft(system: SystemConfig): LimitCycleFromHopfDraft {
  return {
    limitCycleName: '',
    branchName: '',
    parameterName: system.paramNames[0] ?? '',
    amplitude: '0.1',
    ntst: '20',
    ncol: '4',
    stepSize: '0.01',
    maxSteps: '50',
    minStepSize: '1e-5',
    maxStepSize: '0.1',
    correctorSteps: '10',
    correctorTolerance: '1e-6',
    stepTolerance: '1e-6',
    forward: true,
  }
}

function makeLimitCycleFromPDDraft(ncol = 4): LimitCycleFromPDDraft {
  return {
    limitCycleName: '',
    branchName: '',
    amplitude: '0.01',
    ncol: ncol.toString(),
    stepSize: '0.01',
    maxSteps: '50',
    minStepSize: '1e-5',
    maxStepSize: '0.1',
    correctorSteps: '10',
    correctorTolerance: '1e-6',
    stepTolerance: '1e-6',
    forward: true,
  }
}

function makeContinuationDraft(system: SystemConfig): ContinuationDraft {
  return {
    name: '',
    parameterName: system.paramNames[0] ?? '',
    stepSize: '0.01',
    maxSteps: '100',
    minStepSize: '1e-5',
    maxStepSize: '0.1',
    correctorSteps: '4',
    correctorTolerance: '1e-6',
    stepTolerance: '1e-6',
    forward: true,
  }
}

function makeBranchExtensionDraft(
  system: SystemConfig,
  branch?: ContinuationObject | null
): ContinuationDraft {
  const base = makeContinuationDraft(system)
  const defaults = branch?.settings
  return {
    ...base,
    stepSize: defaults?.step_size?.toString() ?? base.stepSize,
    maxSteps: '50',
    minStepSize: defaults?.min_step_size?.toString() ?? base.minStepSize,
    maxStepSize: defaults?.max_step_size?.toString() ?? base.maxStepSize,
    correctorSteps: defaults?.corrector_steps?.toString() ?? base.correctorSteps,
    correctorTolerance: defaults?.corrector_tolerance?.toString() ?? base.correctorTolerance,
    stepTolerance: defaults?.step_tolerance?.toString() ?? base.stepTolerance,
    forward: true,
  }
}

function resolveCodim1ParamNames(
  branch?: ContinuationObject | null
): { param1: string; param2: string } | null {
  const branchType = branch?.data.branch_type
  if (!branchType || typeof branchType !== 'object') return null
  if ('param1_name' in branchType && 'param2_name' in branchType) {
    return { param1: branchType.param1_name, param2: branchType.param2_name }
  }
  return null
}

function makeCodim1CurveDraft(system: SystemConfig): Codim1CurveDraft {
  return {
    name: '',
    param2Name: system.paramNames[0] ?? '',
    stepSize: '0.01',
    maxSteps: '100',
    minStepSize: '1e-6',
    maxStepSize: '0.1',
    correctorSteps: '10',
    correctorTolerance: '1e-8',
    stepTolerance: '1e-8',
    forward: true,
  }
}

function makeSystemDraft(system: SystemConfig): SystemDraft {
  return {
    name: system.name,
    type: system.type,
    solver: system.solver,
    varNames: [...system.varNames],
    paramNames: [...system.paramNames],
    params: system.params.map((value) => value.toString()),
    equations: [...system.equations],
  }
}

function parseNumber(value: string): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function parseInteger(value: string): number | null {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function buildContinuationSettings(draft: ContinuationDraft) {
  const stepSize = parseNumber(draft.stepSize)
  const maxSteps = parseInteger(draft.maxSteps)
  const minStep = parseNumber(draft.minStepSize)
  const maxStep = parseNumber(draft.maxStepSize)
  const correctorSteps = parseInteger(draft.correctorSteps)
  const correctorTolerance = parseNumber(draft.correctorTolerance)
  const stepTolerance = parseNumber(draft.stepTolerance)

  if (
    stepSize === null ||
    maxSteps === null ||
    minStep === null ||
    maxStep === null ||
    correctorSteps === null ||
    correctorTolerance === null ||
    stepTolerance === null
  ) {
    return { settings: null, error: 'Continuation settings must be numeric.' }
  }

  if (stepSize <= 0 || minStep <= 0 || maxStep <= 0) {
    return { settings: null, error: 'Step sizes must be positive numbers.' }
  }

  if (maxSteps <= 0 || correctorSteps <= 0) {
    return { settings: null, error: 'Step counts must be positive integers.' }
  }

  return {
    settings: {
      step_size: Math.max(stepSize, 1e-9),
      min_step_size: Math.max(minStep, 1e-12),
      max_step_size: Math.max(maxStep, 1e-9),
      max_steps: Math.max(Math.trunc(maxSteps), 1),
      corrector_steps: Math.max(Math.trunc(correctorSteps), 1),
      corrector_tolerance: Math.max(correctorTolerance, Number.EPSILON),
      step_tolerance: Math.max(stepTolerance, Number.EPSILON),
    },
    error: null,
  }
}

function buildCodim1ContinuationSettings(draft: Codim1CurveDraft) {
  const stepSize = parseNumber(draft.stepSize)
  const maxSteps = parseInteger(draft.maxSteps)
  const minStep = parseNumber(draft.minStepSize)
  const maxStep = parseNumber(draft.maxStepSize)
  const correctorSteps = parseInteger(draft.correctorSteps)
  const correctorTolerance = parseNumber(draft.correctorTolerance)
  const stepTolerance = parseNumber(draft.stepTolerance)

  if (
    stepSize === null ||
    maxSteps === null ||
    minStep === null ||
    maxStep === null ||
    correctorSteps === null ||
    correctorTolerance === null ||
    stepTolerance === null
  ) {
    return { settings: null, error: 'Continuation settings must be numeric.' }
  }

  if (stepSize <= 0 || minStep <= 0 || maxStep <= 0) {
    return { settings: null, error: 'Step sizes must be positive numbers.' }
  }

  if (maxSteps <= 0 || correctorSteps <= 0) {
    return { settings: null, error: 'Step counts must be positive integers.' }
  }

  return {
    settings: {
      step_size: Math.max(stepSize, 1e-9),
      min_step_size: Math.max(minStep, 1e-12),
      max_step_size: Math.max(maxStep, 1e-9),
      max_steps: Math.max(Math.trunc(maxSteps), 1),
      corrector_steps: Math.max(Math.trunc(correctorSteps), 1),
      corrector_tolerance: Math.max(correctorTolerance, Number.EPSILON),
      step_tolerance: Math.max(stepTolerance, Number.EPSILON),
    },
    error: null,
  }
}

function buildSystemConfig(draft: SystemDraft): SystemConfig {
  return {
    name: draft.name.trim(),
    equations: draft.equations.map((eq) => eq.trim()),
    params: draft.params.map((value) => parseNumber(value) ?? Number.NaN),
    paramNames: draft.paramNames.map((name) => name.trim()),
    varNames: draft.varNames.map((name) => name.trim()),
    solver: draft.solver,
    type: draft.type,
  }
}

function isSystemEqual(a: SystemConfig, b: SystemConfig): boolean {
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.solver === b.solver &&
    a.equations.join('|') === b.equations.join('|') &&
    a.params.join('|') === b.params.join('|') &&
    a.paramNames.join('|') === b.paramNames.join('|') &&
    a.varNames.join('|') === b.varNames.join('|')
  )
}

function buildSystemConfigKey(config: SystemConfig): string {
  return JSON.stringify([
    config.name,
    config.type,
    config.solver,
    config.equations,
    config.params,
    config.paramNames,
    config.varNames,
  ])
}

export function InspectorDetailsPanel({
  system,
  selectedNodeId,
  view,
  theme,
  onRename,
  onToggleVisibility,
  onUpdateRender,
  onUpdateScene,
  onUpdateBifurcationDiagram,
  onUpdateSystem,
  onValidateSystem,
  onRunOrbit,
  onComputeLyapunovExponents,
  onComputeCovariantLyapunovVectors,
  onSolveEquilibrium,
  onCreateLimitCycle,
  onCreateEquilibriumBranch,
  onCreateBranchFromPoint,
  onExtendBranch,
  onCreateFoldCurveFromPoint,
  onCreateHopfCurveFromPoint,
  onCreateLimitCycleFromHopf,
  onCreateLimitCycleFromOrbit,
  onCreateLimitCycleFromPD,
}: InspectorDetailsPanelProps) {
  const node = selectedNodeId ? system.nodes[selectedNodeId] : null
  const object = selectedNodeId ? system.objects[selectedNodeId] : undefined
  const branch = selectedNodeId ? system.branches[selectedNodeId] : undefined
  const orbit = object?.type === 'orbit' ? object : null
  const equilibrium = object?.type === 'equilibrium' ? object : null
  const limitCycle = object?.type === 'limit_cycle' ? object : null
  const selectionKey = selectedNodeId ?? 'none'
  const objectRef = useRef<typeof object>(object)
  const selectionNode = useMemo(() => {
    // Fall back to synthesized nodes so selection info renders even when legacy data
    // lacks a matching tree node entry.
    if (!selectedNodeId) return null
    if (node) return node
    if (object) {
      return {
        id: selectedNodeId,
        name: object.name,
        kind: 'object',
        objectType: object.type,
        parentId: null,
        children: [],
        visibility: true,
        expanded: true,
        render: { ...DEFAULT_RENDER },
      } satisfies TreeNode
    }
    if (branch) {
      return {
        id: selectedNodeId,
        name: branch.name,
        kind: 'branch',
        objectType: 'continuation',
        parentId: null,
        children: [],
        visibility: true,
        expanded: true,
        render: { ...DEFAULT_RENDER },
      } satisfies TreeNode
    }
    return null
  }, [branch, node, object, selectedNodeId])
  const scene = selectedNodeId
    ? system.scenes.find((entry) => entry.id === selectedNodeId)
    : undefined
  const diagram = selectedNodeId
    ? system.bifurcationDiagrams.find((entry) => entry.id === selectedNodeId)
    : undefined
  const sceneId = scene?.id ?? null
  const equilibriumName = equilibrium?.name ?? ''
  const branchName = branch?.name ?? ''
  const branchParameterName = branch?.parameterName ?? ''
  const canExtendBranch = Boolean(
    branch &&
      [
        'equilibrium',
        'limit_cycle',
        'fold_curve',
        'hopf_curve',
        'lpc_curve',
        'pd_curve',
        'ns_curve',
      ].includes(branch.branchType)
  )
  const hasBranch = Boolean(branch)
  const nodeRender = selectionNode
    ? { ...DEFAULT_RENDER, ...(selectionNode.render ?? {}) }
    : DEFAULT_RENDER
  const clvDim = orbit?.covariantVectors?.dim
  const clvPlotDim =
    clvDim ??
    (orbit?.data?.[0] ? orbit.data[0].length - 1 : system.config.varNames.length)
  const clvRender = resolveClvRender(selectionNode?.render?.clv, clvDim)
  const equilibriumEigenpairs = equilibrium?.solution?.eigenpairs ?? []
  const equilibriumEigenspaceIndices = resolveEquilibriumEigenspaceIndices(
    equilibriumEigenpairs
  )
  const equilibriumEigenvectorRender = resolveEquilibriumEigenvectorRender(
    selectionNode?.render?.equilibriumEigenvectors,
    equilibriumEigenspaceIndices
  )
  const clvIndices = defaultClvIndices(clvPlotDim)
  const clvColors = resolveClvColors(
    clvIndices,
    clvRender.vectorIndices,
    clvRender.colors,
    clvRender.colorOverrides
  )
  const clvVisibleSet = new Set(clvRender.vectorIndices)
  const equilibriumEigenvectorIndices = defaultEquilibriumEigenvectorIndices(
    equilibriumEigenspaceIndices
  )
  const equilibriumEigenvectorColors = resolveEquilibriumEigenvectorColors(
    equilibriumEigenvectorIndices,
    equilibriumEigenvectorRender.vectorIndices,
    equilibriumEigenvectorRender.colors,
    equilibriumEigenvectorRender.colorOverrides
  )
  const equilibriumEigenvectorVisibleSet = new Set(equilibriumEigenvectorRender.vectorIndices)
  const equilibriumPlotDim = equilibrium?.solution?.state?.length ?? system.config.varNames.length
  const equilibriumVectorPlotDim = equilibriumPlotDim >= 3 ? 3 : 2
  const equilibriumHasEigenvectors = Boolean(
    equilibriumEigenpairs.some((pair) => pair.vector.length >= equilibriumVectorPlotDim)
  )
  const equilibriumNeeds2d = equilibriumPlotDim < 2
  const nodeVisibility = selectionNode?.visibility ?? true
  const showVisibilityToggle =
    selectionNode?.kind === 'object' || selectionNode?.kind === 'branch'
  const branchEntries = useMemo<BranchEntry[]>(() => {
    return Object.entries(system.branches)
      .map(([id, entry]) => ({
        id,
        name: entry.name,
        type: formatBranchType(entry),
        points: entry.data.points.length,
        visible: system.nodes[id]?.visibility ?? true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [system.branches, system.nodes])
  const objectEntries = useMemo(() => {
    return Object.entries(system.objects)
      .map(([id, obj]) => {
        const node = system.nodes[id]
        return {
          id,
          name: obj.name,
          type: obj.type,
          visible: node?.visibility ?? true,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [system.nodes, system.objects])
  const axisOptions = useMemo(() => {
    const paramOptions = system.config.paramNames.map((name) => ({
      value: formatAxisValue({ kind: 'parameter', name }),
      label: formatAxisLabel('parameter', name),
    }))
    const stateOptions = system.config.varNames.map((name) => ({
      value: formatAxisValue({ kind: 'state', name }),
      label: formatAxisLabel('state', name),
    }))
    return [...paramOptions, ...stateOptions]
  }, [system.config.paramNames, system.config.varNames])
  const branchIndices = useMemo(() => {
    if (!branch) return []
    return ensureBranchIndices(branch.data)
  }, [branch])
  const branchSortedOrder = useMemo(() => {
    if (branchIndices.length === 0) return []
    return buildSortedArrayOrder(branchIndices)
  }, [branchIndices])
  const systemConfigKey = useMemo(() => buildSystemConfigKey(system.config), [system.config])
  const stableSystemConfigRef = useRef(system.config)
  const [branchPointIndex, setBranchPointIndex] = useState<number | null>(null)
  const selectedBranchPoint = useMemo(() => {
    if (!branch || branchPointIndex === null) return null
    return branch.data.points[branchPointIndex] ?? null
  }, [branch, branchPointIndex])

  const [systemDraft, setSystemDraft] = useState<SystemDraft>(() =>
    makeSystemDraft(system.config)
  )
  const [systemTouched, setSystemTouched] = useState(false)
  const [wasmEquationErrors, setWasmEquationErrors] = useState<Array<string | null>>([])
  const [wasmMessage, setWasmMessage] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)

  const [orbitDraft, setOrbitDraft] = useState<OrbitRunDraft>(() =>
    makeOrbitRunDraft(system.config)
  )
  const [orbitError, setOrbitError] = useState<string | null>(null)
  const [orbitPreviewPage, setOrbitPreviewPage] = useState(0)
  const [orbitPreviewInput, setOrbitPreviewInput] = useState('1')
  const [orbitPreviewError, setOrbitPreviewError] = useState<string | null>(null)
  const [lyapunovDraft, setLyapunovDraft] = useState<LyapunovDraft>(() =>
    makeLyapunovDraft()
  )
  const [lyapunovError, setLyapunovError] = useState<string | null>(null)
  const [covariantDraft, setCovariantDraft] = useState<CovariantLyapunovDraft>(() =>
    makeCovariantLyapunovDraft()
  )
  const [covariantError, setCovariantError] = useState<string | null>(null)

  const [equilibriumDraft, setEquilibriumDraft] = useState<EquilibriumSolveDraft>(() =>
    makeEquilibriumSolveDraft(system.config)
  )
  const [equilibriumError, setEquilibriumError] = useState<string | null>(null)

  const [continuationDraft, setContinuationDraft] = useState<ContinuationDraft>(() =>
    makeContinuationDraft(system.config)
  )
  const [continuationError, setContinuationError] = useState<string | null>(null)

  const [limitCycleDraft, setLimitCycleDraft] = useState<LimitCycleDraft>(() =>
    makeLimitCycleDraft(system.config)
  )
  const [limitCycleError, setLimitCycleError] = useState<string | null>(null)
  const [limitCycleFromOrbitDraft, setLimitCycleFromOrbitDraft] =
    useState<LimitCycleFromOrbitDraft>(() => makeLimitCycleFromOrbitDraft(system.config))
  const [limitCycleFromOrbitError, setLimitCycleFromOrbitError] = useState<string | null>(
    null
  )
  const [limitCycleFromHopfDraft, setLimitCycleFromHopfDraft] =
    useState<LimitCycleFromHopfDraft>(() => makeLimitCycleFromHopfDraft(system.config))
  const [limitCycleFromHopfError, setLimitCycleFromHopfError] = useState<string | null>(null)
  const [limitCycleFromPDDraft, setLimitCycleFromPDDraft] = useState<LimitCycleFromPDDraft>(
    () => makeLimitCycleFromPDDraft()
  )
  const [limitCycleFromPDError, setLimitCycleFromPDError] = useState<string | null>(null)
  const [foldCurveDraft, setFoldCurveDraft] = useState<Codim1CurveDraft>(() =>
    makeCodim1CurveDraft(system.config)
  )
  const [foldCurveError, setFoldCurveError] = useState<string | null>(null)
  const [hopfCurveDraft, setHopfCurveDraft] = useState<Codim1CurveDraft>(() =>
    makeCodim1CurveDraft(system.config)
  )
  const [hopfCurveError, setHopfCurveError] = useState<string | null>(null)
  const [branchContinuationDraft, setBranchContinuationDraft] =
    useState<ContinuationDraft>(() => makeContinuationDraft(system.config))
  const [branchContinuationError, setBranchContinuationError] = useState<string | null>(null)
  const [branchExtensionDraft, setBranchExtensionDraft] = useState<ContinuationDraft>(() =>
    makeBranchExtensionDraft(system.config)
  )
  const [branchExtensionError, setBranchExtensionError] = useState<string | null>(null)
  const [branchPointInput, setBranchPointInput] = useState('')
  const [branchPointError, setBranchPointError] = useState<string | null>(null)
  const [sceneSearch, setSceneSearch] = useState('')
  const [diagramSearch, setDiagramSearch] = useState('')
  const orbitPreviewPageCount = useMemo(() => {
    if (!orbit || orbit.data.length === 0) return 0
    return Math.ceil(orbit.data.length / ORBIT_PREVIEW_PAGE_SIZE)
  }, [orbit])
  const orbitPreviewVarNames = useMemo(() => {
    if (!orbit || orbit.data.length === 0) return []
    const varCount = Math.max(orbit.data[0].length - 1, 0)
    return Array.from({ length: varCount }, (_, index) => {
      return systemDraft.varNames[index] || `x${index + 1}`
    })
  }, [orbit, systemDraft.varNames])
  const orbitPreviewStart = orbitPreviewPage * ORBIT_PREVIEW_PAGE_SIZE
  const orbitPreviewEnd = orbit
    ? Math.min(orbitPreviewStart + ORBIT_PREVIEW_PAGE_SIZE, orbit.data.length)
    : 0
  const orbitPreviewRows = orbit ? orbit.data.slice(orbitPreviewStart, orbitPreviewEnd) : []
  const limitCycleMesh = useMemo(() => {
    if (!branch || branch.branchType !== 'limit_cycle') {
      return { ntst: 20, ncol: 4 }
    }
    const branchType = branch.data.branch_type
    if (branchType?.type === 'LimitCycle') {
      return { ntst: branchType.ntst, ncol: branchType.ncol }
    }
    return { ntst: 20, ncol: 4 }
  }, [branch])

  const limitCycleFromPDNameSuggestion = useMemo(() => {
    if (!branch) return 'lc_pd'
    const safeBranchName = toCliSafeName(branch.name)
    const pointIndex = branchPointIndex ?? 0
    return `lc_pd_${safeBranchName}_idx${pointIndex}`
  }, [branch, branchPointIndex])

  const limitCycleFromPDBranchSuggestion = useMemo(() => {
    const baseName =
      limitCycleFromPDDraft.limitCycleName.trim() || limitCycleFromPDNameSuggestion
    const safeBaseName = toCliSafeName(baseName)
    const safeParamName = branchParameterName ? toCliSafeName(branchParameterName) : ''
    return safeParamName ? `${safeBaseName}_${safeParamName}` : safeBaseName
  }, [
    branchParameterName,
    limitCycleFromPDDraft.limitCycleName,
    limitCycleFromPDNameSuggestion,
  ])

  useEffect(() => {
    setSystemDraft(makeSystemDraft(system.config))
    setSystemTouched(false)
    setWasmEquationErrors([])
    setWasmMessage(null)
  }, [system.config, system.id])

  useEffect(() => {
    setOrbitPreviewPage(0)
    setOrbitPreviewInput('1')
    setOrbitPreviewError(null)
  }, [selectedNodeId, orbit?.data.length])

  useEffect(() => {
    objectRef.current = object
  }, [object])

  useEffect(() => {
    stableSystemConfigRef.current = system.config
  }, [system.config])

  useEffect(() => {
    setOrbitDraft((prev) => ({
      ...prev,
      initialState: adjustArray(prev.initialState, systemDraft.varNames.length, () => '0'),
    }))
    setEquilibriumDraft((prev) => ({
      ...prev,
      initialGuess: adjustArray(prev.initialGuess, systemDraft.varNames.length, () => '0'),
    }))
    setLimitCycleDraft((prev) => ({
      ...prev,
      state: adjustArray(prev.state, systemDraft.varNames.length, () => '0'),
    }))
  }, [systemDraft.varNames.length])

  useEffect(() => {
    if (systemDraft.type === 'map') {
      setSystemDraft((prev) => ({ ...prev, solver: 'discrete' }))
    } else if (!FLOW_SOLVERS.includes(systemDraft.solver)) {
      setSystemDraft((prev) => ({ ...prev, solver: 'rk4' }))
    }
  }, [systemDraft.type, systemDraft.solver])

  useEffect(() => {
    setLimitCycleDraft((prev) => {
      if (systemDraft.paramNames.length === 0) {
        if (!prev.parameterName) return prev
        return { ...prev, parameterName: '' }
      }
      if (systemDraft.paramNames.includes(prev.parameterName)) {
        return prev
      }
      return { ...prev, parameterName: systemDraft.paramNames[0] }
    })
  }, [systemDraft.paramNames])

  useEffect(() => {
    setContinuationDraft((prev) => {
      if (systemDraft.paramNames.length === 0) {
        if (!prev.parameterName) return prev
        return { ...prev, parameterName: '' }
      }
      if (systemDraft.paramNames.includes(prev.parameterName)) {
        return prev
      }
      return { ...prev, parameterName: systemDraft.paramNames[0] ?? '' }
    })
    setLimitCycleFromOrbitDraft((prev) => {
      if (systemDraft.paramNames.length === 0) {
        if (!prev.parameterName) return prev
        return { ...prev, parameterName: '' }
      }
      if (systemDraft.paramNames.includes(prev.parameterName)) {
        return prev
      }
      return { ...prev, parameterName: systemDraft.paramNames[0] ?? '' }
    })
    setLimitCycleFromHopfDraft((prev) => {
      if (systemDraft.paramNames.length === 0) {
        if (!prev.parameterName) return prev
        return { ...prev, parameterName: '' }
      }
      if (systemDraft.paramNames.includes(prev.parameterName)) {
        return prev
      }
      return { ...prev, parameterName: systemDraft.paramNames[0] ?? '' }
    })
    setBranchContinuationDraft((prev) => {
      if (systemDraft.paramNames.length === 0) {
        if (!prev.parameterName) return prev
        return { ...prev, parameterName: '' }
      }
      if (systemDraft.paramNames.includes(prev.parameterName)) {
        return prev
      }
      return { ...prev, parameterName: systemDraft.paramNames[0] ?? '' }
    })
    setFoldCurveDraft((prev) => {
      if (systemDraft.paramNames.length === 0) {
        if (!prev.param2Name) return prev
        return { ...prev, param2Name: '' }
      }
      if (systemDraft.paramNames.includes(prev.param2Name)) {
        return prev
      }
      return { ...prev, param2Name: systemDraft.paramNames[0] ?? '' }
    })
    setHopfCurveDraft((prev) => {
      if (systemDraft.paramNames.length === 0) {
        if (!prev.param2Name) return prev
        return { ...prev, param2Name: '' }
      }
      if (systemDraft.paramNames.includes(prev.param2Name)) {
        return prev
      }
      return { ...prev, param2Name: systemDraft.paramNames[0] ?? '' }
    })
  }, [systemDraft.paramNames])

  useEffect(() => {
    const current = objectRef.current
    if (!current) return
    const stableSystemConfig = stableSystemConfigRef.current
    if (current.type === 'orbit') {
      setOrbitDraft(makeOrbitRunDraft(stableSystemConfig, current))
      setLyapunovDraft(makeLyapunovDraft())
      setCovariantDraft(makeCovariantLyapunovDraft())
      setLimitCycleDraft((prev) => ({
        ...makeLimitCycleDraft(stableSystemConfig, current),
        name: prev.name,
      }))
      setLimitCycleFromOrbitDraft((prev) => ({
        ...makeLimitCycleFromOrbitDraft(stableSystemConfig),
        limitCycleName: prev.limitCycleName,
        branchName: prev.branchName,
        parameterName: stableSystemConfig.paramNames.includes(prev.parameterName)
          ? prev.parameterName
          : stableSystemConfig.paramNames[0] ?? '',
      }))
      setOrbitError(null)
      setLyapunovError(null)
      setCovariantError(null)
      setLimitCycleError(null)
      setLimitCycleFromOrbitError(null)
    }
    if (current.type === 'equilibrium') {
      setEquilibriumDraft(makeEquilibriumSolveDraft(stableSystemConfig, current))
      setEquilibriumError(null)
      setContinuationDraft((prev) => ({
        ...makeContinuationDraft(stableSystemConfig),
        name: prev.name,
      }))
      setContinuationError(null)
    }
  }, [object?.type, selectedNodeId, systemConfigKey])

  useEffect(() => {
    if (!sceneId) return
    setSceneSearch('')
  }, [sceneId])

  useEffect(() => {
    if (!equilibriumName) return
    setContinuationDraft((prev) => {
      const paramName = systemDraft.paramNames.includes(prev.parameterName)
        ? prev.parameterName
        : systemDraft.paramNames[0] ?? ''
      const safeEquilibriumName = toCliSafeName(equilibriumName)
      const safeParamName = paramName ? toCliSafeName(paramName) : ''
      const suggestedName = safeParamName
        ? `${safeEquilibriumName}_${safeParamName}`
        : safeEquilibriumName
      const nextName = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, parameterName: paramName, name: nextName }
    })
  }, [equilibriumName, systemDraft.paramNames])

  useEffect(() => {
    if (!orbit) return
    setLimitCycleFromOrbitDraft((prev) => {
      const suggestedLimitCycleName = `lc_${toCliSafeName(orbit.name)}`
      const limitCycleName =
        prev.limitCycleName.trim().length > 0 ? prev.limitCycleName : suggestedLimitCycleName
      const paramName = systemDraft.paramNames.includes(prev.parameterName)
        ? prev.parameterName
        : systemDraft.paramNames[0] ?? ''
      const safeLimitCycleName = toCliSafeName(limitCycleName)
      const safeParamName = paramName ? toCliSafeName(paramName) : ''
      const suggestedBranchName = safeParamName
        ? `${safeLimitCycleName}_${safeParamName}`
        : safeLimitCycleName
      const branchName =
        prev.branchName.trim().length > 0 ? prev.branchName : suggestedBranchName
      return { ...prev, limitCycleName, branchName, parameterName: paramName }
    })
  }, [orbit, systemDraft.paramNames])

  useEffect(() => {
    if (!branchName) return
    const fallbackParam =
      systemDraft.paramNames.find((name) => name !== branchParameterName) ??
      systemDraft.paramNames[0] ??
      ''
    const hopfCodim1Params = resolveCodim1ParamNames(branch)
    const hopfDefaultParam =
      branch?.branchType === 'equilibrium' &&
      systemDraft.paramNames.includes(branch.parameterName)
        ? branch.parameterName
        : branch?.branchType === 'hopf_curve' &&
            hopfCodim1Params &&
            systemDraft.paramNames.includes(hopfCodim1Params.param1)
          ? hopfCodim1Params.param1
          : branch?.branchType === 'hopf_curve' &&
              hopfCodim1Params &&
              systemDraft.paramNames.includes(hopfCodim1Params.param2)
            ? hopfCodim1Params.param2
            : systemDraft.paramNames[0] ?? ''
    setBranchContinuationDraft((prev) => {
      const paramName = systemDraft.paramNames.includes(prev.parameterName)
        ? prev.parameterName
        : fallbackParam
      const safeBranchName = toCliSafeName(branchName)
      const safeParamName = paramName ? toCliSafeName(paramName) : ''
      const suggestedName = safeParamName
        ? `${safeBranchName}_${safeParamName}`
        : safeBranchName
      const nextName = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, parameterName: paramName, name: nextName }
    })
    setFoldCurveDraft((prev) => {
      const param2Name =
        systemDraft.paramNames.includes(prev.param2Name) &&
        prev.param2Name !== branchParameterName
          ? prev.param2Name
          : fallbackParam
      const safeBranchName = toCliSafeName(branchName)
      const suggestedName = `fold_curve_${safeBranchName}`
      const nextName = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, param2Name, name: nextName }
    })
    setHopfCurveDraft((prev) => {
      const param2Name =
        systemDraft.paramNames.includes(prev.param2Name) &&
        prev.param2Name !== branchParameterName
          ? prev.param2Name
          : fallbackParam
      const safeBranchName = toCliSafeName(branchName)
      const suggestedName = `hopf_curve_${safeBranchName}`
      const nextName = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, param2Name, name: nextName }
    })
    setLimitCycleFromHopfDraft((prev) => {
      const safeBranchName = toCliSafeName(branchName)
      const suggestedLimitCycleName = `lc_hopf_${safeBranchName}`
      const limitCycleName =
        prev.limitCycleName.trim().length > 0 ? prev.limitCycleName : suggestedLimitCycleName
      const paramName = systemDraft.paramNames.includes(prev.parameterName)
        ? prev.parameterName
        : hopfDefaultParam
      const safeLimitCycleName = toCliSafeName(limitCycleName)
      const safeParamName = paramName ? toCliSafeName(paramName) : ''
      const suggestedBranchName = safeParamName
        ? `${safeLimitCycleName}_${safeParamName}`
        : safeLimitCycleName
      const branchNameValue =
        prev.branchName.trim().length > 0 ? prev.branchName : suggestedBranchName
      return {
        ...prev,
        limitCycleName,
        branchName: branchNameValue,
        parameterName: paramName,
      }
    })
    setLimitCycleFromPDDraft((prev) => ({
      ...prev,
      ncol: limitCycleMesh.ncol.toString(),
    }))
    setBranchExtensionDraft(makeBranchExtensionDraft(stableSystemConfigRef.current, branch))
    setBranchContinuationError(null)
    setBranchExtensionError(null)
    setBranchPointError(null)
    setFoldCurveError(null)
    setHopfCurveError(null)
    setLimitCycleFromHopfError(null)
    setLimitCycleFromPDError(null)
  }, [branch, branchName, branchParameterName, limitCycleMesh.ncol, systemDraft.paramNames])

  useEffect(() => {
    if (!hasBranch) {
      setBranchPointIndex(null)
      setBranchPointInput('')
      return
    }
    if (branchSortedOrder.length === 0) {
      setBranchPointIndex(null)
      setBranchPointInput('')
      return
    }
    const initialIndex = branchSortedOrder[0]
    setBranchPointIndex(initialIndex)
    const logicalIndex = branchIndices[initialIndex]
    setBranchPointInput(
      typeof logicalIndex === 'number' ? logicalIndex.toString() : ''
    )
    setBranchPointError(null)
  }, [branchName, branchIndices, branchSortedOrder, hasBranch])

  const systemConfig = useMemo(() => buildSystemConfig(systemDraft), [systemDraft])
  const systemValidation = useMemo(() => validateSystemConfig(systemConfig), [systemConfig])
  const systemDirty = useMemo(
    () => !isSystemEqual(systemConfig, system.config),
    [system.config, systemConfig]
  )
  const showSystemErrors = systemTouched || systemDirty
  const hasWasmErrors = wasmEquationErrors.some((entry) => entry)
  const runDisabled = systemDirty || !systemValidation.valid || hasWasmErrors
  const isDiscreteMap = systemDraft.type === 'map'
  const plotlyBackground = resolvePlotlyBackgroundColor(theme)
  const equilibriumEigenPlot = useMemo(() => {
    const eigenpairs = equilibrium?.solution?.eigenpairs
    if (!eigenpairs || eigenpairs.length === 0) return null
    return buildEigenvaluePlot(eigenpairs.map((pair) => pair.value), plotlyBackground, {
      showRadiusLines: isDiscreteMap,
    })
  }, [equilibrium?.solution?.eigenpairs, isDiscreteMap, plotlyBackground])

  useEffect(() => {
    if (!systemDirty && !systemTouched) {
      setWasmEquationErrors([])
      setWasmMessage(null)
      return
    }
    if (!systemValidation.valid) {
      setWasmEquationErrors([])
      setWasmMessage(null)
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setIsValidating(true)
      try {
        const result = await onValidateSystem(systemConfig, { signal: controller.signal })
        setWasmEquationErrors(result.equationErrors ?? [])
        setWasmMessage(result.message ?? null)
      } catch (err) {
        if (controller.signal.aborted) return
        const message = err instanceof Error ? err.message : String(err)
        setWasmMessage(message)
      } finally {
        if (!controller.signal.aborted) setIsValidating(false)
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [onValidateSystem, systemConfig, systemDirty, systemTouched, systemValidation.valid])

  const summary = useMemo(() => {
    if (object) {
      if (object.type === 'orbit') {
        return {
          label: 'Orbit',
          detail: `${object.data.length} points`,
        }
      }
      if (object.type === 'equilibrium') {
        return {
          label: 'Equilibrium',
          detail: object.solution ? 'Solved' : 'Not solved',
        }
      }
      if (object.type === 'limit_cycle') {
        return {
          label: 'Limit Cycle',
          detail: `Period ${object.period}`,
        }
      }
      return null
    }

    if (branch) {
      return {
        label: 'Branch',
        detail: `${formatBranchType(branch)} · ${branch.data.points.length} points`,
      }
    }

    if (scene) {
      return {
        label: 'Scene',
        detail: scene.display === 'selection' ? 'Selection focus' : 'All visible orbits',
      }
    }

    if (diagram) {
      const branchCount = diagram.selectedBranchIds.length
      return {
        label: 'Bifurcation',
        detail: branchCount
          ? `${branchCount} branch${branchCount === 1 ? '' : 'es'} enabled`
          : 'No branches enabled',
      }
    }

    return null
  }, [branch, diagram, object, scene])

  const limitCycleNameSuggestion = useMemo(() => {
    const names = Object.values(system.objects).map((obj) => obj.name)
    return nextName('Limit Cycle', names)
  }, [system.objects])

  const limitCycleFromOrbitNameSuggestion = useMemo(() => {
    if (!orbit) return 'lc_orbit'
    return `lc_${toCliSafeName(orbit.name)}`
  }, [orbit])

  const limitCycleFromOrbitBranchSuggestion = useMemo(() => {
    const baseName =
      limitCycleFromOrbitDraft.limitCycleName.trim() || limitCycleFromOrbitNameSuggestion
    const paramName = limitCycleFromOrbitDraft.parameterName
    const safeBaseName = toCliSafeName(baseName)
    const safeParamName = paramName ? toCliSafeName(paramName) : ''
    return safeParamName ? `${safeBaseName}_${safeParamName}` : safeBaseName
  }, [
    limitCycleFromOrbitDraft.limitCycleName,
    limitCycleFromOrbitDraft.parameterName,
    limitCycleFromOrbitNameSuggestion,
  ])

  const limitCycleFromHopfBranchSuggestion = useMemo(() => {
    if (!branch) return ''
    const baseName =
      limitCycleFromHopfDraft.limitCycleName.trim() || `lc_hopf_${toCliSafeName(branch.name)}`
    const paramName = limitCycleFromHopfDraft.parameterName
    const safeBaseName = toCliSafeName(baseName)
    const safeParamName = paramName ? toCliSafeName(paramName) : ''
    return safeParamName ? `${safeBaseName}_${safeParamName}` : safeBaseName
  }, [branch, limitCycleFromHopfDraft.limitCycleName, limitCycleFromHopfDraft.parameterName])

  const sceneSelectedIds = useMemo(
    () => scene?.selectedNodeIds ?? [],
    [scene?.selectedNodeIds]
  )
  const sceneSelectedSet = useMemo(() => new Set(sceneSelectedIds), [sceneSelectedIds])
  const sceneFilteredObjects = useMemo(() => {
    const query = sceneSearch.trim().toLowerCase()
    if (!query) return objectEntries
    return objectEntries.filter((entry) => {
      const name = entry.name.toLowerCase()
      const type = entry.type.replace('_', ' ').toLowerCase()
      return name.includes(query) || type.includes(query)
    })
  }, [objectEntries, sceneSearch])
  const sceneSelectedEntries = useMemo(() => {
    if (!scene) return []
    const byId = new Map(objectEntries.map((entry) => [entry.id, entry]))
    return sceneSelectedIds
      .map((id) => byId.get(id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  }, [objectEntries, scene, sceneSelectedIds])
  const diagramSelectedIds = useMemo(
    () => diagram?.selectedBranchIds ?? [],
    [diagram?.selectedBranchIds]
  )
  const diagramSelectedSet = useMemo(
    () => new Set(diagramSelectedIds),
    [diagramSelectedIds]
  )
  const diagramFilteredBranches = useMemo(() => {
    const query = diagramSearch.trim().toLowerCase()
    if (!query) return branchEntries
    return branchEntries.filter((entry) => {
      const name = entry.name.toLowerCase()
      const type = entry.type.toLowerCase()
      return name.includes(query) || type.includes(query)
    })
  }, [branchEntries, diagramSearch])
  const diagramSelectedEntries = useMemo(() => {
    if (!diagram) return []
    const byId = new Map(branchEntries.map((entry) => [entry.id, entry]))
    return diagramSelectedIds
      .map((id) => byId.get(id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  }, [branchEntries, diagram, diagramSelectedIds])
  const branchParams = useMemo(() => {
    if (!branch) return []
    return getBranchParams(system, branch)
  }, [branch, system])
  const continuationParamIndex = branch
    ? systemDraft.paramNames.indexOf(branch.parameterName)
    : -1
  const codim1ParamNames = useMemo(() => resolveCodim1ParamNames(branch), [branch])
  const branchBifurcations = useMemo(
    () => (branch ? branch.data.bifurcations ?? [] : []),
    [branch]
  )
  const codim1ParamOptions = useMemo(() => {
    return systemDraft.paramNames.filter((name) => name !== branchParameterName)
  }, [systemDraft.paramNames, branchParameterName])
  const branchStartIndex = branchSortedOrder[0]
  const branchEndIndex = branchSortedOrder[branchSortedOrder.length - 1]
  const branchStartPoint = branchStartIndex !== undefined ? branch?.data.points[branchStartIndex] : null
  const branchEndPoint = branchEndIndex !== undefined ? branch?.data.points[branchEndIndex] : null
  const hopfOmega = selectedBranchPoint ? extractHopfOmega(selectedBranchPoint) : null
  const isHopfSourceBranch =
    branch?.branchType === 'equilibrium' || branch?.branchType === 'hopf_curve'
  const isHopfPointSelected =
    !!selectedBranchPoint &&
    (branch?.branchType === 'equilibrium'
      ? selectedBranchPoint.stability === 'Hopf'
      : true)
  const branchEigenvalues = selectedBranchPoint
    ? normalizeEigenvalueArray(selectedBranchPoint.eigenvalues)
    : []
  const branchEigenPlot =
    branch?.branchType === 'equilibrium'
      ? buildEigenvaluePlot(branchEigenvalues, plotlyBackground, { showRadiusLines: isDiscreteMap })
      : null

  const handleApplySystem = async () => {
    setSystemTouched(true)
    if (!systemValidation.valid) return
    setIsValidating(true)
    try {
      const result = await onValidateSystem(systemConfig)
      setWasmEquationErrors(result.equationErrors ?? [])
      setWasmMessage(result.message ?? null)
      if (!result.ok || result.equationErrors.some((entry) => entry)) {
        return
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setWasmMessage(message)
      return
    } finally {
      setIsValidating(false)
    }
    await onUpdateSystem(systemConfig)
  }

  const handleRunOrbit = async () => {
    if (runDisabled) {
      setOrbitError('Apply valid system settings before running orbits.')
      return
    }
    if (!object || object.type !== 'orbit' || !selectedNodeId) {
      setOrbitError('Select an orbit to integrate.')
      return
    }
    const duration = parseNumber(orbitDraft.duration)
    const dt = systemDraft.type === 'map' ? 1 : parseNumber(orbitDraft.dt)
    const initialState = orbitDraft.initialState.map((value) => parseNumber(value))

    if (duration === null || duration <= 0) {
      setOrbitError('Duration must be a positive number.')
      return
    }
    if (dt === null || dt <= 0) {
      setOrbitError('Step size must be a positive number.')
      return
    }
    if (initialState.some((value) => value === null)) {
      setOrbitError('Initial state values must be numeric.')
      return
    }

    setOrbitError(null)
    const request: OrbitRunRequest = {
      orbitId: selectedNodeId,
      initialState: initialState.map((value) => value ?? 0),
      duration,
      dt: systemDraft.type === 'map' ? undefined : dt,
    }
    await onRunOrbit(request)
  }

  const handleComputeLyapunov = async () => {
    if (runDisabled) {
      setLyapunovError('Apply valid system settings before computing Lyapunov exponents.')
      return
    }
    if (!orbit || !selectedNodeId) {
      setLyapunovError('Select an orbit to analyze.')
      return
    }
    if (!orbit.data || orbit.data.length < 2) {
      setLyapunovError('Run an orbit before computing Lyapunov exponents.')
      return
    }

    const duration = orbit.t_end - orbit.t_start
    if (!Number.isFinite(duration) || duration <= 0) {
      setLyapunovError('Orbit has no duration to analyze.')
      return
    }

    const transient = parseNumber(lyapunovDraft.transient)
    const qrStride = parseInteger(lyapunovDraft.qrStride)
    if (transient === null || transient < 0) {
      setLyapunovError('Transient time must be a non-negative number.')
      return
    }
    if (qrStride === null || qrStride <= 0) {
      setLyapunovError('QR stride must be a positive integer.')
      return
    }

    if (transient >= duration) {
      setLyapunovError('Transient leaves no data to analyze.')
      return
    }

    setLyapunovError(null)
    const request: OrbitLyapunovRequest = {
      orbitId: selectedNodeId,
      transient,
      qrStride,
    }
    await onComputeLyapunovExponents(request)
  }

  const handleComputeCovariant = async () => {
    if (runDisabled) {
      setCovariantError('Apply valid system settings before computing covariant vectors.')
      return
    }
    if (!orbit || !selectedNodeId) {
      setCovariantError('Select an orbit to analyze.')
      return
    }
    if (!orbit.data || orbit.data.length < 2) {
      setCovariantError('Run an orbit before computing covariant vectors.')
      return
    }

    const duration = orbit.t_end - orbit.t_start
    if (!Number.isFinite(duration) || duration <= 0) {
      setCovariantError('Orbit has no duration to analyze.')
      return
    }

    const transient = parseNumber(covariantDraft.transient)
    const forward = parseNumber(covariantDraft.forward)
    const backward = parseNumber(covariantDraft.backward)
    const qrStride = parseInteger(covariantDraft.qrStride)

    if (transient === null || transient < 0) {
      setCovariantError('Transient time must be a non-negative number.')
      return
    }
    if (forward === null || forward < 0) {
      setCovariantError('Forward transient must be a non-negative number.')
      return
    }
    if (backward === null || backward < 0) {
      setCovariantError('Backward transient must be a non-negative number.')
      return
    }
    if (qrStride === null || qrStride <= 0) {
      setCovariantError('QR stride must be a positive integer.')
      return
    }

    if (transient + forward + backward >= duration) {
      setCovariantError('Transient windows exceed the orbit duration.')
      return
    }

    setCovariantError(null)
    const request: OrbitCovariantLyapunovRequest = {
      orbitId: selectedNodeId,
      transient,
      forward,
      backward,
      qrStride,
    }
    await onComputeCovariantLyapunovVectors(request)
  }

  const setOrbitPreviewPageIndex = (page: number) => {
    if (!orbit || orbit.data.length === 0) return
    const maxPage = Math.max(orbitPreviewPageCount - 1, 0)
    const nextPage = Math.min(Math.max(page, 0), maxPage)
    setOrbitPreviewPage(nextPage)
    setOrbitPreviewInput((nextPage + 1).toString())
    setOrbitPreviewError(null)
  }

  const handleOrbitPreviewJump = () => {
    if (!orbit || orbitPreviewPageCount === 0) return
    const target = parseInteger(orbitPreviewInput)
    if (target === null) {
      setOrbitPreviewError('Enter a valid page number.')
      return
    }
    if (target < 1 || target > orbitPreviewPageCount) {
      setOrbitPreviewError(`Page must be between 1 and ${orbitPreviewPageCount}.`)
      return
    }
    setOrbitPreviewPageIndex(target - 1)
  }

  const handleSolveEquilibrium = async () => {
    if (runDisabled) {
      setEquilibriumError('Apply valid system settings before solving equilibria.')
      return
    }
    if (!object || object.type !== 'equilibrium' || !selectedNodeId) {
      setEquilibriumError('Select an equilibrium to solve.')
      return
    }
    const maxSteps = parseNumber(equilibriumDraft.maxSteps)
    const dampingFactor = parseNumber(equilibriumDraft.dampingFactor)
    const initialGuess = equilibriumDraft.initialGuess.map((value) => parseNumber(value))

    if (maxSteps === null || maxSteps <= 0) {
      setEquilibriumError('Max steps must be a positive number.')
      return
    }
    if (dampingFactor === null || dampingFactor <= 0) {
      setEquilibriumError('Damping factor must be a positive number.')
      return
    }
    if (initialGuess.some((value) => value === null)) {
      setEquilibriumError('Initial guess values must be numeric.')
      return
    }

    setEquilibriumError(null)
    const request: EquilibriumSolveRequest = {
      equilibriumId: selectedNodeId,
      initialGuess: initialGuess.map((value) => value ?? 0),
      maxSteps,
      dampingFactor,
    }
    await onSolveEquilibrium(request)
  }

  const handleCreateEquilibriumBranch = async () => {
    if (runDisabled) {
      setContinuationError('Apply valid system settings before continuing.')
      return
    }
    if (!equilibrium || !selectedNodeId) {
      setContinuationError('Select an equilibrium to continue.')
      return
    }
    if (!equilibrium.solution) {
      setContinuationError('Solve the equilibrium before continuing.')
      return
    }
    if (systemDraft.paramNames.length === 0) {
      setContinuationError('Add a parameter before continuing.')
      return
    }
    if (!continuationDraft.parameterName) {
      setContinuationError('Select a continuation parameter.')
      return
    }

    const safeEquilibriumName = toCliSafeName(equilibrium.name)
    const safeParamName = continuationDraft.parameterName
      ? toCliSafeName(continuationDraft.parameterName)
      : ''
    const suggestedName = safeParamName
      ? `${safeEquilibriumName}_${safeParamName}`
      : safeEquilibriumName
    const name = continuationDraft.name.trim() || suggestedName
    if (!name.trim()) {
      setContinuationError('Branch name is required.')
      return
    }
    if (!isCliSafeName(name)) {
      setContinuationError('Branch names must be alphanumeric with underscores only.')
      return
    }

    const { settings, error } = buildContinuationSettings(continuationDraft)
    if (!settings) {
      setContinuationError(error ?? 'Invalid continuation settings.')
      return
    }

    setContinuationError(null)
    await onCreateEquilibriumBranch({
      equilibriumId: selectedNodeId,
      name,
      parameterName: continuationDraft.parameterName,
      settings,
      forward: continuationDraft.forward,
    })
  }

  const setBranchPoint = (arrayIndex: number) => {
    setBranchPointIndex(arrayIndex)
    const logicalIndex = branchIndices[arrayIndex]
    setBranchPointInput(
      typeof logicalIndex === 'number' ? logicalIndex.toString() : ''
    )
    setBranchPointError(null)
  }

  const handleJumpToBranchPoint = () => {
    if (!branch) return
    const target = parseInteger(branchPointInput)
    if (target === null) {
      setBranchPointError('Enter a valid integer index.')
      return
    }
    const arrayIndex = branchIndices.findIndex((value) => value === target)
    if (arrayIndex < 0) {
      setBranchPointError('Index not found in this branch.')
      return
    }
    setBranchPoint(arrayIndex)
  }

  const handleCreateBranchFromPoint = async () => {
    if (runDisabled) {
      setBranchContinuationError('Apply valid system settings before continuing.')
      return
    }
    if (!branch || !selectedNodeId) {
      setBranchContinuationError('Select a branch to continue.')
      return
    }
    if (branch.branchType !== 'equilibrium') {
      setBranchContinuationError('Continuation is only available for equilibrium branches.')
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null) {
      setBranchContinuationError('Select a branch point to continue from.')
      return
    }
    if (systemDraft.paramNames.length === 0) {
      setBranchContinuationError('Add a parameter before continuing.')
      return
    }
    if (!branchContinuationDraft.parameterName) {
      setBranchContinuationError('Select a continuation parameter.')
      return
    }

    const safeBranchName = toCliSafeName(branch.name)
    const safeParamName = branchContinuationDraft.parameterName
      ? toCliSafeName(branchContinuationDraft.parameterName)
      : ''
    const suggestedName = safeParamName
      ? `${safeBranchName}_${safeParamName}`
      : safeBranchName
    const name = branchContinuationDraft.name.trim() || suggestedName
    if (!name.trim()) {
      setBranchContinuationError('Branch name is required.')
      return
    }
    if (!isCliSafeName(name)) {
      setBranchContinuationError('Branch names must be alphanumeric with underscores only.')
      return
    }

    const { settings, error } = buildContinuationSettings(branchContinuationDraft)
    if (!settings) {
      setBranchContinuationError(error ?? 'Invalid continuation settings.')
      return
    }

    setBranchContinuationError(null)
    await onCreateBranchFromPoint({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      name,
      parameterName: branchContinuationDraft.parameterName,
      settings,
      forward: branchContinuationDraft.forward,
    })
  }

  const handleExtendBranch = async () => {
    if (runDisabled) {
      setBranchExtensionError('Apply valid system settings before extending.')
      return
    }
    if (!branch || !selectedNodeId) {
      setBranchExtensionError('Select a branch to extend.')
      return
    }
    if (!canExtendBranch) {
      setBranchExtensionError(
        'Branch extension is only available for equilibrium, limit cycle, or bifurcation curve branches.'
      )
      return
    }

    const { settings, error } = buildContinuationSettings(branchExtensionDraft)
    if (!settings) {
      setBranchExtensionError(error ?? 'Invalid continuation settings.')
      return
    }

    setBranchExtensionError(null)
    await onExtendBranch({
      branchId: selectedNodeId,
      settings,
      forward: branchExtensionDraft.forward,
    })
  }

  const handleCreateFoldCurve = async () => {
    if (runDisabled) {
      setFoldCurveError('Apply valid system settings before continuing.')
      return
    }
    if (!branch || !selectedNodeId) {
      setFoldCurveError('Select a branch to continue.')
      return
    }
    if (branch.branchType !== 'equilibrium') {
      setFoldCurveError('Fold curve continuation is only available for equilibrium branches.')
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null) {
      setFoldCurveError('Select a branch point to continue from.')
      return
    }
    if (selectedBranchPoint.stability !== 'Fold') {
      setFoldCurveError('Select a Fold bifurcation point to continue.')
      return
    }
    if (systemDraft.paramNames.length < 2) {
      setFoldCurveError('Add another parameter before continuing.')
      return
    }
    if (!foldCurveDraft.param2Name) {
      setFoldCurveError('Select a second continuation parameter.')
      return
    }
    if (foldCurveDraft.param2Name === branchParameterName) {
      setFoldCurveError('Second parameter must be different from the continuation parameter.')
      return
    }

    const safeBranchName = toCliSafeName(branch.name)
    const suggestedName = `fold_curve_${safeBranchName}`
    const name = foldCurveDraft.name.trim() || suggestedName
    if (!name.trim()) {
      setFoldCurveError('Curve name is required.')
      return
    }
    if (!isCliSafeName(name)) {
      setFoldCurveError('Curve names must be alphanumeric with underscores only.')
      return
    }

    const { settings, error } = buildCodim1ContinuationSettings(foldCurveDraft)
    if (!settings) {
      setFoldCurveError(error ?? 'Invalid continuation settings.')
      return
    }

    setFoldCurveError(null)
    await onCreateFoldCurveFromPoint({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      name,
      param2Name: foldCurveDraft.param2Name,
      settings,
      forward: foldCurveDraft.forward,
    })
  }

  const handleCreateHopfCurve = async () => {
    if (runDisabled) {
      setHopfCurveError('Apply valid system settings before continuing.')
      return
    }
    if (!branch || !selectedNodeId) {
      setHopfCurveError('Select a branch to continue.')
      return
    }
    if (branch.branchType !== 'equilibrium') {
      setHopfCurveError('Hopf curve continuation is only available for equilibrium branches.')
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null) {
      setHopfCurveError('Select a branch point to continue from.')
      return
    }
    if (selectedBranchPoint.stability !== 'Hopf') {
      setHopfCurveError('Select a Hopf bifurcation point to continue.')
      return
    }
    if (systemDraft.paramNames.length < 2) {
      setHopfCurveError('Add another parameter before continuing.')
      return
    }
    if (!hopfCurveDraft.param2Name) {
      setHopfCurveError('Select a second continuation parameter.')
      return
    }
    if (hopfCurveDraft.param2Name === branchParameterName) {
      setHopfCurveError('Second parameter must be different from the continuation parameter.')
      return
    }

    const safeBranchName = toCliSafeName(branch.name)
    const suggestedName = `hopf_curve_${safeBranchName}`
    const name = hopfCurveDraft.name.trim() || suggestedName
    if (!name.trim()) {
      setHopfCurveError('Curve name is required.')
      return
    }
    if (!isCliSafeName(name)) {
      setHopfCurveError('Curve names must be alphanumeric with underscores only.')
      return
    }

    const { settings, error } = buildCodim1ContinuationSettings(hopfCurveDraft)
    if (!settings) {
      setHopfCurveError(error ?? 'Invalid continuation settings.')
      return
    }

    setHopfCurveError(null)
    await onCreateHopfCurveFromPoint({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      name,
      param2Name: hopfCurveDraft.param2Name,
      settings,
      forward: hopfCurveDraft.forward,
    })
  }

  const handleCreateLimitCycleFromHopf = async () => {
    if (runDisabled) {
      setLimitCycleFromHopfError('Apply valid system settings before continuing.')
      return
    }
    if (systemDraft.type === 'map') {
      setLimitCycleFromHopfError('Limit cycles require a flow system.')
      return
    }
    if (!branch || !selectedNodeId) {
      setLimitCycleFromHopfError('Select a branch to continue.')
      return
    }
    if (!isHopfSourceBranch) {
      setLimitCycleFromHopfError(
        'Limit cycle continuation is only available for equilibrium or Hopf curve branches.'
      )
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null) {
      setLimitCycleFromHopfError('Select a branch point to continue from.')
      return
    }
    if (branch.branchType === 'equilibrium' && selectedBranchPoint.stability !== 'Hopf') {
      setLimitCycleFromHopfError('Select a Hopf bifurcation point to continue.')
      return
    }
    if (!systemDraft.paramNames.includes(limitCycleFromHopfDraft.parameterName)) {
      setLimitCycleFromHopfError('Continuation parameter is not defined in this system.')
      return
    }

    const limitCycleName = limitCycleFromHopfDraft.limitCycleName.trim()
    if (!limitCycleName) {
      setLimitCycleFromHopfError('Limit cycle name is required.')
      return
    }
    if (!isCliSafeName(limitCycleName)) {
      setLimitCycleFromHopfError('Limit cycle names must be alphanumeric with underscores only.')
      return
    }

    const branchName = limitCycleFromHopfDraft.branchName.trim()
    if (!branchName) {
      setLimitCycleFromHopfError('Branch name is required.')
      return
    }
    if (!isCliSafeName(branchName)) {
      setLimitCycleFromHopfError('Branch names must be alphanumeric with underscores only.')
      return
    }

    const amplitude = parseNumber(limitCycleFromHopfDraft.amplitude)
    if (amplitude === null || amplitude <= 0) {
      setLimitCycleFromHopfError('Amplitude must be a positive number.')
      return
    }

    const ntst = parseInteger(limitCycleFromHopfDraft.ntst)
    if (ntst === null || ntst <= 0) {
      setLimitCycleFromHopfError('NTST must be a positive integer.')
      return
    }

    const ncol = parseInteger(limitCycleFromHopfDraft.ncol)
    if (ncol === null || ncol <= 0) {
      setLimitCycleFromHopfError('NCOL must be a positive integer.')
      return
    }

    const { settings, error } = buildContinuationSettings({
      name: '',
      parameterName: limitCycleFromHopfDraft.parameterName,
      stepSize: limitCycleFromHopfDraft.stepSize,
      maxSteps: limitCycleFromHopfDraft.maxSteps,
      minStepSize: limitCycleFromHopfDraft.minStepSize,
      maxStepSize: limitCycleFromHopfDraft.maxStepSize,
      correctorSteps: limitCycleFromHopfDraft.correctorSteps,
      correctorTolerance: limitCycleFromHopfDraft.correctorTolerance,
      stepTolerance: limitCycleFromHopfDraft.stepTolerance,
      forward: limitCycleFromHopfDraft.forward,
    })
    if (!settings) {
      setLimitCycleFromHopfError(error ?? 'Invalid continuation settings.')
      return
    }

    setLimitCycleFromHopfError(null)
    await onCreateLimitCycleFromHopf({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      parameterName: limitCycleFromHopfDraft.parameterName,
      limitCycleName,
      branchName,
      amplitude,
      ntst,
      ncol,
      settings,
      forward: limitCycleFromHopfDraft.forward,
    })
  }

  const handleCreateLimitCycleFromPD = async () => {
    if (runDisabled) {
      setLimitCycleFromPDError('Apply valid system settings before continuing.')
      return
    }
    if (systemDraft.type === 'map') {
      setLimitCycleFromPDError('Limit cycles require a flow system.')
      return
    }
    if (!branch || !selectedNodeId) {
      setLimitCycleFromPDError('Select a branch to continue.')
      return
    }
    if (branch.branchType !== 'limit_cycle') {
      setLimitCycleFromPDError(
        'Period-doubling branching is only available for limit cycle branches.'
      )
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null) {
      setLimitCycleFromPDError('Select a branch point to continue from.')
      return
    }
    if (selectedBranchPoint.stability !== 'PeriodDoubling') {
      setLimitCycleFromPDError('Select a Period Doubling point to branch.')
      return
    }
    if (!branchParameterName || !systemDraft.paramNames.includes(branchParameterName)) {
      setLimitCycleFromPDError('Continuation parameter is not defined in this system.')
      return
    }

    const limitCycleName =
      limitCycleFromPDDraft.limitCycleName.trim() || limitCycleFromPDNameSuggestion
    if (!limitCycleName) {
      setLimitCycleFromPDError('Limit cycle name is required.')
      return
    }
    if (!isCliSafeName(limitCycleName)) {
      setLimitCycleFromPDError('Limit cycle names must be alphanumeric with underscores only.')
      return
    }

    const branchName =
      limitCycleFromPDDraft.branchName.trim() || limitCycleFromPDBranchSuggestion
    if (!branchName) {
      setLimitCycleFromPDError('Branch name is required.')
      return
    }
    if (!isCliSafeName(branchName)) {
      setLimitCycleFromPDError('Branch names must be alphanumeric with underscores only.')
      return
    }

    const amplitude = parseNumber(limitCycleFromPDDraft.amplitude)
    if (amplitude === null || amplitude <= 0) {
      setLimitCycleFromPDError('Amplitude must be a positive number.')
      return
    }

    const ncol = parseInteger(limitCycleFromPDDraft.ncol)
    if (ncol === null || ncol <= 0) {
      setLimitCycleFromPDError('NCOL must be a positive integer.')
      return
    }

    const { settings, error } = buildContinuationSettings({
      name: '',
      parameterName: branchParameterName,
      stepSize: limitCycleFromPDDraft.stepSize,
      maxSteps: limitCycleFromPDDraft.maxSteps,
      minStepSize: limitCycleFromPDDraft.minStepSize,
      maxStepSize: limitCycleFromPDDraft.maxStepSize,
      correctorSteps: limitCycleFromPDDraft.correctorSteps,
      correctorTolerance: limitCycleFromPDDraft.correctorTolerance,
      stepTolerance: limitCycleFromPDDraft.stepTolerance,
      forward: limitCycleFromPDDraft.forward,
    })
    if (!settings) {
      setLimitCycleFromPDError(error ?? 'Invalid continuation settings.')
      return
    }

    setLimitCycleFromPDError(null)
    await onCreateLimitCycleFromPD({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      limitCycleName,
      branchName,
      amplitude,
      ncol,
      settings,
      forward: limitCycleFromPDDraft.forward,
    })
  }

  const handleCreateLimitCycleFromOrbit = async () => {
    if (runDisabled) {
      setLimitCycleFromOrbitError('Apply valid system settings before continuing.')
      return
    }
    if (systemDraft.type === 'map') {
      setLimitCycleFromOrbitError('Limit cycles require a flow system.')
      return
    }
    if (!orbit || !selectedNodeId) {
      setLimitCycleFromOrbitError('Select an orbit to continue.')
      return
    }
    if (orbit.data.length === 0) {
      setLimitCycleFromOrbitError('Run an orbit before continuing.')
      return
    }
    if (systemDraft.paramNames.length === 0) {
      setLimitCycleFromOrbitError('Add a parameter before continuing.')
      return
    }
    if (!systemDraft.paramNames.includes(limitCycleFromOrbitDraft.parameterName)) {
      setLimitCycleFromOrbitError('Select a continuation parameter.')
      return
    }

    const limitCycleName =
      limitCycleFromOrbitDraft.limitCycleName.trim() || limitCycleFromOrbitNameSuggestion
    if (!limitCycleName) {
      setLimitCycleFromOrbitError('Limit cycle name is required.')
      return
    }
    if (!isCliSafeName(limitCycleName)) {
      setLimitCycleFromOrbitError('Limit cycle names must be alphanumeric with underscores only.')
      return
    }

    const branchName =
      limitCycleFromOrbitDraft.branchName.trim() || limitCycleFromOrbitBranchSuggestion
    if (!branchName) {
      setLimitCycleFromOrbitError('Branch name is required.')
      return
    }
    if (!isCliSafeName(branchName)) {
      setLimitCycleFromOrbitError('Branch names must be alphanumeric with underscores only.')
      return
    }

    const tolerance = parseNumber(limitCycleFromOrbitDraft.tolerance)
    if (tolerance === null || tolerance <= 0) {
      setLimitCycleFromOrbitError('Tolerance must be a positive number.')
      return
    }

    const ntst = parseInteger(limitCycleFromOrbitDraft.ntst)
    if (ntst === null || ntst <= 0) {
      setLimitCycleFromOrbitError('NTST must be a positive integer.')
      return
    }

    const ncol = parseInteger(limitCycleFromOrbitDraft.ncol)
    if (ncol === null || ncol <= 0) {
      setLimitCycleFromOrbitError('NCOL must be a positive integer.')
      return
    }

    const { settings, error } = buildContinuationSettings({
      name: '',
      parameterName: limitCycleFromOrbitDraft.parameterName,
      stepSize: limitCycleFromOrbitDraft.stepSize,
      maxSteps: limitCycleFromOrbitDraft.maxSteps,
      minStepSize: limitCycleFromOrbitDraft.minStepSize,
      maxStepSize: limitCycleFromOrbitDraft.maxStepSize,
      correctorSteps: limitCycleFromOrbitDraft.correctorSteps,
      correctorTolerance: limitCycleFromOrbitDraft.correctorTolerance,
      stepTolerance: limitCycleFromOrbitDraft.stepTolerance,
      forward: limitCycleFromOrbitDraft.forward,
    })
    if (!settings) {
      setLimitCycleFromOrbitError(error ?? 'Invalid continuation settings.')
      return
    }

    setLimitCycleFromOrbitError(null)
    await onCreateLimitCycleFromOrbit({
      orbitId: selectedNodeId,
      limitCycleName,
      branchName,
      parameterName: limitCycleFromOrbitDraft.parameterName,
      tolerance,
      ntst,
      ncol,
      settings,
      forward: limitCycleFromOrbitDraft.forward,
    })
  }

  const handleCreateLimitCycle = async () => {
    if (runDisabled) {
      setLimitCycleError('Apply valid system settings before creating objects.')
      return
    }
    if (systemDraft.type === 'map') {
      setLimitCycleError('Limit cycles require a flow system.')
      return
    }
    if (!object || object.type !== 'orbit' || !selectedNodeId) {
      setLimitCycleError('Select an orbit to initialize from.')
      return
    }
    const name = limitCycleDraft.name.trim() || limitCycleNameSuggestion
    if (!isCliSafeName(name)) {
      setLimitCycleError('Limit cycle names must be alphanumeric with underscores only.')
      return
    }
    const period = parseNumber(limitCycleDraft.period)
    const ntst = parseNumber(limitCycleDraft.ntst)
    const ncol = parseNumber(limitCycleDraft.ncol)
    const state = limitCycleDraft.state.map((value) => parseNumber(value))

    if (period === null || period <= 0) {
      setLimitCycleError('Period must be a positive number.')
      return
    }
    if (ntst === null || ntst <= 0) {
      setLimitCycleError('NTST must be a positive number.')
      return
    }
    if (ncol === null || ncol <= 0) {
      setLimitCycleError('NCOL must be a positive number.')
      return
    }
    if (state.some((value) => value === null)) {
      setLimitCycleError('State values must be numeric.')
      return
    }

    setLimitCycleError(null)
    const request: LimitCycleCreateRequest = {
      name,
      originOrbitId: selectedNodeId,
      period,
      state: state.map((value) => value ?? 0),
      ntst,
      ncol,
      parameterName: limitCycleDraft.parameterName.trim() || undefined,
    }
    await onCreateLimitCycle(request)
    setLimitCycleDraft((prev) => ({ ...prev, name: '' }))
  }

  const renderSystemErrors = () => {
    if (!showSystemErrors || systemValidation.valid) return null
    return (
      <div className="field-error" data-testid="system-errors">
        Fix the highlighted system fields before applying changes.
      </div>
    )
  }

  const mapEquationLabel = (varName: string) =>
    systemDraft.type === 'map' ? `${varName}_{n+1}` : `d${varName}/dt`

  const renderSystemView = () => (
    <div className="inspector-panel" data-testid="inspector-panel-body">
      <div className="inspector-group">
        <div className="inspector-group__summary">System</div>
        <div className="inspector-section">
          <label>
            System Name
            <input
              value={systemDraft.name}
              onChange={(event) =>
                setSystemDraft((prev) => ({ ...prev, name: event.target.value }))
              }
              data-testid="system-name"
            />
            {showSystemErrors && systemValidation.errors.name ? (
              <span className="field-error">{systemValidation.errors.name}</span>
            ) : null}
          </label>
          {systemValidation.warnings.length > 0 ? (
            <div className="field-warning">
              {systemValidation.warnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : null}
          <label>
            System Type
            <select
              value={systemDraft.type}
              onChange={(event) =>
                setSystemDraft((prev) => ({
                  ...prev,
                  type: event.target.value === 'map' ? 'map' : 'flow',
                }))
              }
              data-testid="system-type"
            >
              <option value="flow">Flow (ODE)</option>
              <option value="map">Map (Iterated)</option>
            </select>
          </label>
          <label>
            Solver
            <select
              value={systemDraft.solver}
              onChange={(event) =>
                setSystemDraft((prev) => ({ ...prev, solver: event.target.value }))
              }
              data-testid="system-solver"
            >
              {(systemDraft.type === 'map' ? MAP_SOLVERS : FLOW_SOLVERS).map((solver) => (
                <option key={solver} value={solver}>
                  {solver}
                </option>
              ))}
            </select>
            {showSystemErrors && systemValidation.errors.solver ? (
              <span className="field-error">{systemValidation.errors.solver}</span>
            ) : null}
          </label>
        </div>

        <div className="inspector-section">
          <div className="inspector-group__header">
            <h3>Variables + Equations</h3>
            <button
              onClick={() =>
                setSystemDraft((prev) => ({
                  ...prev,
                  varNames: [...prev.varNames, `x${prev.varNames.length + 1}`],
                  equations: [...prev.equations, ''],
                }))
              }
              data-testid="system-add-variable"
            >
              Add Variable
            </button>
          </div>
          {showSystemErrors && systemValidation.errors.varNames ? (
            <div className="field-error">{systemValidation.errors.varNames}</div>
          ) : null}
          <div className="inspector-list">
            {systemDraft.varNames.map((varName, index) => (
              <div className="inspector-row" key={`var-${index}`}>
                <input
                  value={varName}
                  onChange={(event) =>
                    setSystemDraft((prev) => {
                      const nextVarNames = [...prev.varNames]
                      nextVarNames[index] = event.target.value
                      return { ...prev, varNames: nextVarNames }
                    })
                  }
                  data-testid={`system-var-${index}`}
                />
                <div className="inspector-row__stack">
                  <textarea
                    value={systemDraft.equations[index] ?? ''}
                    onChange={(event) =>
                      setSystemDraft((prev) => {
                        const nextEquations = adjustArray(
                          prev.equations,
                          prev.varNames.length,
                          () => ''
                        )
                        nextEquations[index] = event.target.value
                        return { ...prev, equations: nextEquations }
                      })
                    }
                    placeholder={`${mapEquationLabel(varName)} = ...`}
                    data-testid={`system-eq-${index}`}
                  />
                  {wasmEquationErrors[index] ? (
                    <span className="field-error" data-testid={`system-eq-error-${index}`}>
                      {wasmEquationErrors[index]}
                    </span>
                  ) : null}
                </div>
                <button
                  onClick={() =>
                    setSystemDraft((prev) => {
                      const nextVarNames = prev.varNames.filter((_, i) => i !== index)
                      const nextEquations = prev.equations.filter((_, i) => i !== index)
                      return { ...prev, varNames: nextVarNames, equations: nextEquations }
                    })
                  }
                  aria-label="Remove variable"
                  data-testid={`system-remove-var-${index}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {showSystemErrors && systemValidation.errors.equations ? (
            <div className="field-error">
              {systemValidation.errors.equations
                ?.map((error, idx) => (error ? `Eq ${idx + 1}: ${error}` : null))
                .filter(Boolean)
                .join(' ')}
            </div>
          ) : null}
        </div>

        <div className="inspector-section">
          <div className="inspector-group__header">
            <h3>Parameters</h3>
            <button
              onClick={() =>
                setSystemDraft((prev) => ({
                  ...prev,
                  paramNames: [...prev.paramNames, `p${prev.paramNames.length + 1}`],
                  params: [...prev.params, '0'],
                }))
              }
              data-testid="system-add-parameter"
            >
              Add Parameter
            </button>
          </div>
          {showSystemErrors && systemValidation.errors.paramNames ? (
            <div className="field-error">{systemValidation.errors.paramNames}</div>
          ) : null}
          <div className="inspector-list">
            {systemDraft.paramNames.map((paramName, index) => (
              <div className="inspector-row inspector-row--param" key={`param-${index}`}>
                <input
                  value={paramName}
                  onChange={(event) =>
                    setSystemDraft((prev) => {
                      const nextParamNames = [...prev.paramNames]
                      nextParamNames[index] = event.target.value
                      return { ...prev, paramNames: nextParamNames }
                    })
                  }
                  data-testid={`system-param-${index}`}
                />
                <input
                  type="number"
                  value={systemDraft.params[index] ?? ''}
                  onChange={(event) =>
                    setSystemDraft((prev) => {
                      const nextParams = adjustArray(prev.params, prev.paramNames.length, () => '0')
                      nextParams[index] = event.target.value
                      return { ...prev, params: nextParams }
                    })
                  }
                  data-testid={`system-param-value-${index}`}
                />
                <button
                  onClick={() =>
                    setSystemDraft((prev) => {
                      const nextParamNames = prev.paramNames.filter((_, i) => i !== index)
                      const nextParams = prev.params.filter((_, i) => i !== index)
                      return { ...prev, paramNames: nextParamNames, params: nextParams }
                    })
                  }
                  aria-label="Remove parameter"
                  data-testid={`system-remove-param-${index}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {showSystemErrors && systemValidation.errors.params ? (
            <div className="field-error">
              {systemValidation.errors.params
                ?.map((error, idx) => (error ? `Param ${idx + 1}: ${error}` : null))
                .filter(Boolean)
                .join(' ')}
            </div>
          ) : null}
        </div>

        {renderSystemErrors()}
        {wasmMessage ? <div className="field-error">{wasmMessage}</div> : null}
        {isValidating ? <div className="field-warning">Validating equations…</div> : null}
        <div className="inspector-section">
          <button onClick={handleApplySystem} data-testid="system-apply">
            Apply System Changes
          </button>
        </div>
      </div>
    </div>
  )

  const updateClvRender = useCallback(
    (update: Partial<ClvRenderStyle>) => {
      if (!selectionNode) return
      const merged = resolveClvRender({ ...clvRender, ...update }, clvDim)
      onUpdateRender(selectionNode.id, { clv: merged })
    },
    [clvDim, clvRender, onUpdateRender, selectionNode]
  )

  const updateEquilibriumEigenvectorRender = useCallback(
    (update: Partial<EquilibriumEigenvectorRenderStyle>) => {
      if (!selectionNode) return
      const merged = resolveEquilibriumEigenvectorRender(
        { ...equilibriumEigenvectorRender, ...update },
        equilibriumEigenspaceIndices
      )
      onUpdateRender(selectionNode.id, { equilibriumEigenvectors: merged })
    },
    [equilibriumEigenspaceIndices, equilibriumEigenvectorRender, onUpdateRender, selectionNode]
  )

  const handleEquilibriumEigenvectorVisibilityChange = (index: number, visible: boolean) => {
    const nextSet = new Set(equilibriumEigenvectorRender.vectorIndices)
    if (visible) {
      nextSet.add(index)
    } else {
      nextSet.delete(index)
    }
    const nextIndices = equilibriumEigenvectorIndices.filter((value) => nextSet.has(value))
    const colors = resolveEquilibriumEigenvectorColors(
      nextIndices,
      equilibriumEigenvectorRender.vectorIndices,
      equilibriumEigenvectorRender.colors,
      equilibriumEigenvectorRender.colorOverrides
    )
    updateEquilibriumEigenvectorRender({ vectorIndices: nextIndices, colors })
  }

  const handleEquilibriumEigenvectorColorChange = (index: number, color: string) => {
    const colorIndex = equilibriumEigenvectorRender.vectorIndices.indexOf(index)
    if (colorIndex === -1) return
    const colors = equilibriumEigenvectorRender.colors.map((value, idx) =>
      idx === colorIndex ? color : value
    )
    updateEquilibriumEigenvectorRender({ colors })
  }

  const handleClvVisibilityChange = (index: number, visible: boolean) => {
    const nextSet = new Set(clvRender.vectorIndices)
    if (visible) {
      nextSet.add(index)
    } else {
      nextSet.delete(index)
    }
    const nextIndices = clvIndices.filter((value) => nextSet.has(value))
    const colors = resolveClvColors(
      nextIndices,
      clvRender.vectorIndices,
      clvRender.colors,
      clvRender.colorOverrides
    )
    updateClvRender({ vectorIndices: nextIndices, colors })
  }

  const handleClvColorChange = (index: number, color: string) => {
    const colorIndex = clvRender.vectorIndices.indexOf(index)
    if (colorIndex === -1) return
    const colors = clvRender.colors.map((value, idx) =>
      idx === colorIndex ? color : value
    )
    updateClvRender({ colors })
  }

  const renderSelectionView = () => {
    const lyapunovDimension =
      orbit?.lyapunovExponents && orbit.lyapunovExponents.length > 0
        ? kaplanYorkeDimension(orbit.lyapunovExponents)
        : null
    const clvHasData = Boolean(
      orbit?.covariantVectors && orbit.covariantVectors.vectors.length > 0
    )
    const clvNeeds2d = clvPlotDim < 2

    return (
      <div className="inspector-panel" data-testid="inspector-panel-body">
        {selectionNode ? (
          <div className="inspector-group">
            <div className="inspector-group__summary">Selection</div>
            <div className="inspector-section">
              <label>
                Name
                <input
                  value={selectionNode.name}
                  onChange={(event) => onRename(selectionNode.id, event.target.value)}
                  data-testid="inspector-name"
                />
              </label>
              <div className="inspector-meta">
                <span>{selectionNode.objectType ?? selectionNode.kind}</span>
                {summary ? <span>{summary.detail}</span> : null}
              </div>
            </div>

          {showVisibilityToggle ? (
            <div className="inspector-section">
              <button
                onClick={() => onToggleVisibility(selectionNode.id)}
                data-testid="inspector-visibility"
              >
                {nodeVisibility ? 'Visible' : 'Hidden'}
              </button>
            </div>
          ) : null}

          {selectionNode.kind === 'object' || selectionNode.kind === 'branch' ? (
            <div className="inspector-section">
              <label>
                Color
                <input
                  type="color"
                  value={nodeRender.color}
                  onChange={(event) =>
                    onUpdateRender(selectionNode.id, { color: event.target.value })
                  }
                  data-testid="inspector-color"
                />
              </label>
              <label>
                Line Width
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={nodeRender.lineWidth}
                  onChange={(event) =>
                    onUpdateRender(selectionNode.id, { lineWidth: Number(event.target.value) })
                  }
                  data-testid="inspector-line-width"
                />
              </label>
              <label>
                Point Size
                <input
                  type="number"
                  min={2}
                  max={12}
                  value={nodeRender.pointSize}
                  onChange={(event) =>
                    onUpdateRender(selectionNode.id, { pointSize: Number(event.target.value) })
                  }
                  data-testid="inspector-point-size"
                />
              </label>
            </div>
          ) : null}

          {orbit ? (
            <>
              <InspectorDisclosure
                key={`${selectionKey}-orbit-data`}
                title="Orbit Data"
                testId="orbit-data-toggle"
              >
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Summary</h4>
                  <InspectorMetrics
                    rows={[
                      { label: 'System', value: orbit.systemName },
                      { label: 'Data points', value: orbit.data.length.toLocaleString() },
                      {
                        label: 'Time range',
                        value:
                          orbit.data.length > 0
                            ? `${formatFixed(orbit.t_start, 3)} to ${formatFixed(orbit.t_end, 3)}`
                            : 'n/a',
                      },
                      { label: 'Step size (dt)', value: formatFixed(orbit.dt, 4) },
                      ...(lyapunovDimension !== null
                        ? [
                            {
                              label: 'Lyapunov dimension',
                              value: formatNumber(lyapunovDimension, 6),
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Parameters (last run)</h4>
                  {orbit.parameters && orbit.parameters.length > 0 ? (
                    <InspectorMetrics
                      rows={orbit.parameters.map((value, index) => ({
                        label: systemDraft.paramNames[index] || `p${index + 1}`,
                        value: formatNumber(value, 6),
                      }))}
                    />
                  ) : (
                    <p className="empty-state">Parameters not recorded yet.</p>
                  )}
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Data preview</h4>
                  {orbit.data.length > 0 ? (
                    <div className="orbit-preview">
                      <div className="orbit-preview__controls">
                        <div className="inspector-row">
                          <button
                            type="button"
                            onClick={() => setOrbitPreviewPageIndex(orbitPreviewPage - 1)}
                            disabled={orbitPreviewPage <= 0}
                            data-testid="orbit-preview-prev"
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            onClick={() => setOrbitPreviewPageIndex(orbitPreviewPage + 1)}
                            disabled={orbitPreviewPage >= orbitPreviewPageCount - 1}
                            data-testid="orbit-preview-next"
                          >
                            Next
                          </button>
                          <span className="orbit-preview__page">
                            Page {orbitPreviewPage + 1} of {orbitPreviewPageCount}
                          </span>
                        </div>
                        <label>
                          Jump to page
                          <div className="inspector-row orbit-preview__jump">
                            <input
                              type="number"
                              min={1}
                              max={orbitPreviewPageCount}
                              value={orbitPreviewInput}
                              onChange={(event) => {
                                setOrbitPreviewInput(event.target.value)
                                setOrbitPreviewError(null)
                              }}
                              data-testid="orbit-preview-page-input"
                            />
                            <button
                              type="button"
                              onClick={handleOrbitPreviewJump}
                              data-testid="orbit-preview-page-jump"
                            >
                              Jump
                            </button>
                          </div>
                        </label>
                        {orbitPreviewError ? (
                          <div className="field-error">{orbitPreviewError}</div>
                        ) : null}
                        <div className="orbit-preview__summary">
                          Showing {orbitPreviewStart + 1}–{orbitPreviewEnd} of{' '}
                          {orbit.data.length.toLocaleString()}
                        </div>
                      </div>
                      <div
                        className="orbit-preview__table"
                        role="region"
                        aria-label="Orbit data preview"
                      >
                        <table className="orbit-preview__table-grid">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>t</th>
                              {orbitPreviewVarNames.map((name, index) => (
                                <th key={`orbit-preview-col-${index}`}>{name}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {orbitPreviewRows.map((point, rowIndex) => (
                              <tr key={`orbit-preview-row-${orbitPreviewStart + rowIndex}`}>
                                <td>{orbitPreviewStart + rowIndex}</td>
                                <td>{formatFixed(point[0], 3)}</td>
                                {orbitPreviewVarNames.map((_, varIndex) => (
                                  <td key={`orbit-preview-cell-${rowIndex}-${varIndex}`}>
                                    {formatFixed(point[varIndex + 1] ?? Number.NaN, 4)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <p className="empty-state">No orbit samples stored yet.</p>
                  )}
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Lyapunov exponents</h4>
                  {orbit.lyapunovExponents && orbit.lyapunovExponents.length > 0 ? (
                    <>
                      <InspectorMetrics
                        rows={[
                          ...orbit.lyapunovExponents.map((value, index) => ({
                            label: `λ${index + 1}`,
                            value: formatFixed(value, 6),
                          })),
                          ...(lyapunovDimension !== null
                            ? [
                                {
                                  label: 'Lyapunov dimension',
                                  value: formatNumber(lyapunovDimension, 6),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </>
                  ) : (
                    <p className="empty-state">Lyapunov exponents not computed yet.</p>
                  )}
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Covariant Lyapunov vectors</h4>
                  {orbit.covariantVectors && orbit.covariantVectors.vectors.length > 0 ? (
                    <>
                      <InspectorMetrics
                        rows={[
                          {
                            label: 'Checkpoints',
                            value: orbit.covariantVectors.vectors.length.toLocaleString(),
                          },
                          { label: 'Dimension', value: orbit.covariantVectors.dim },
                          {
                            label: 'Time span',
                            value:
                              orbit.covariantVectors.times.length > 0
                                ? `${formatFixed(orbit.covariantVectors.times[0], 3)} to ${formatFixed(
                                    orbit.covariantVectors.times[
                                      orbit.covariantVectors.times.length - 1
                                    ],
                                    3
                                  )}`
                                : 'n/a',
                          },
                        ]}
                      />
                      {orbit.covariantVectors.vectors[0] ? (
                        <div className="inspector-data">
                          {orbit.covariantVectors.vectors[0].map((vec, index) => (
                            <div key={`clv-${index}`}>
                              v{index + 1}: [{vec.map((value) => formatFixed(value, 4)).join(', ')}
                              ]
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="empty-state">Covariant Lyapunov vectors not computed yet.</p>
                  )}
                </div>
              </InspectorDisclosure>

              <InspectorDisclosure
                key={`${selectionKey}-clv-plot`}
                title="CLV Plotting"
                testId="clv-plot-toggle"
                defaultOpen={false}
              >
                <div className="inspector-section">
                  {!clvHasData ? (
                    <p className="empty-state">Covariant vectors not computed yet.</p>
                  ) : null}
                  {clvNeeds2d ? (
                    <div className="field-warning">
                      CLV plotting requires at least two state variables.
                    </div>
                  ) : null}
                  <label>
                    Show CLV vectors
                    <input
                      type="checkbox"
                      checked={clvRender.enabled}
                      onChange={(event) => updateClvRender({ enabled: event.target.checked })}
                      data-testid="clv-plot-enabled"
                    />
                  </label>
                  <label>
                    Stride (plot every Nth checkpoint)
                    <input
                      type="number"
                      min={1}
                      value={clvRender.stride}
                      onChange={(event) =>
                        updateClvRender({ stride: Number(event.target.value) })
                      }
                      data-testid="clv-plot-stride"
                    />
                  </label>
                  <label>
                    Arrow length (fraction of orbit size)
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={clvRender.lengthScale}
                      onChange={(event) =>
                        updateClvRender({ lengthScale: Number(event.target.value) })
                      }
                      data-testid="clv-plot-length"
                    />
                  </label>
                  <label>
                    Arrowhead scale
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={clvRender.headScale}
                      onChange={(event) =>
                        updateClvRender({ headScale: Number(event.target.value) })
                      }
                      data-testid="clv-plot-head-scale"
                    />
                  </label>
                  <label>
                    Arrow thickness (px)
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={clvRender.thickness}
                      onChange={(event) =>
                        updateClvRender({ thickness: Number(event.target.value) })
                      }
                      data-testid="clv-plot-thickness"
                    />
                  </label>
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Vector colors</h4>
                  {clvIndices.length > 0 ? (
                    <div className="inspector-list">
                      {clvIndices.map((index, idx) => {
                        const visible = clvVisibleSet.has(index)
                        return (
                          <div className="clv-control-row" key={`clv-color-${index}`}>
                            <span className="clv-control-row__label">CLV {index + 1}</span>
                            <input
                              type="checkbox"
                              checked={visible}
                              onChange={(event) =>
                                handleClvVisibilityChange(index, event.target.checked)
                              }
                              aria-label={`Show CLV ${index + 1}`}
                              data-testid={`clv-plot-show-${index}`}
                            />
                            <input
                              type="color"
                              value={clvColors[idx]}
                              onChange={(event) =>
                                handleClvColorChange(index, event.target.value)
                              }
                              disabled={!visible}
                              aria-label={`CLV ${index + 1} color`}
                              data-testid={`clv-plot-color-${index}`}
                            />
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="empty-state">Covariant vectors not computed yet.</p>
                  )}
                </div>
              </InspectorDisclosure>

              <InspectorDisclosure
                key={`${selectionKey}-oseledets`}
                title="Oseledets Solver"
                testId="oseledets-toggle"
                defaultOpen={false}
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes before computing Lyapunov data.
                    </div>
                  ) : null}
                  {!orbit.data || orbit.data.length < 2 ? (
                    <p className="empty-state">Run an orbit to enable Lyapunov analysis.</p>
                  ) : null}
                  <h4 className="inspector-subheading">Lyapunov exponents</h4>
                  <label>
                    {systemDraft.type === 'map'
                      ? 'Transient iterations to discard'
                      : 'Transient time to discard'}
                    <input
                      type="number"
                      value={lyapunovDraft.transient}
                      onChange={(event) =>
                        setLyapunovDraft((prev) => ({
                          ...prev,
                          transient: event.target.value,
                        }))
                      }
                      data-testid="lyapunov-transient"
                    />
                  </label>
                  <label>
                    Steps between QR decompositions
                    <input
                      type="number"
                      value={lyapunovDraft.qrStride}
                      onChange={(event) =>
                        setLyapunovDraft((prev) => ({
                          ...prev,
                          qrStride: event.target.value,
                        }))
                      }
                      data-testid="lyapunov-qr"
                    />
                  </label>
                  {lyapunovError ? <div className="field-error">{lyapunovError}</div> : null}
                  <button
                    onClick={handleComputeLyapunov}
                    disabled={runDisabled}
                    data-testid="lyapunov-submit"
                  >
                    Compute Lyapunov Exponents
                  </button>
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Covariant Lyapunov vectors</h4>
                  <label>
                    {systemDraft.type === 'map'
                      ? 'Transient iterations to discard'
                      : 'Transient time to discard'}
                    <input
                      type="number"
                      value={covariantDraft.transient}
                      onChange={(event) =>
                        setCovariantDraft((prev) => ({
                          ...prev,
                          transient: event.target.value,
                        }))
                      }
                      data-testid="clv-transient"
                    />
                  </label>
                  <label>
                    {systemDraft.type === 'map'
                      ? 'Forward transient (pre-window steps)'
                      : 'Forward transient (pre-window)'}
                    <input
                      type="number"
                      value={covariantDraft.forward}
                      onChange={(event) =>
                        setCovariantDraft((prev) => ({
                          ...prev,
                          forward: event.target.value,
                        }))
                      }
                      data-testid="clv-forward"
                    />
                  </label>
                  <label>
                    {systemDraft.type === 'map'
                      ? 'Backward transient (post-window steps)'
                      : 'Backward transient (post-window)'}
                    <input
                      type="number"
                      value={covariantDraft.backward}
                      onChange={(event) =>
                        setCovariantDraft((prev) => ({
                          ...prev,
                          backward: event.target.value,
                        }))
                      }
                      data-testid="clv-backward"
                    />
                  </label>
                  <label>
                    Steps between QR decompositions
                    <input
                      type="number"
                      value={covariantDraft.qrStride}
                      onChange={(event) =>
                        setCovariantDraft((prev) => ({
                          ...prev,
                          qrStride: event.target.value,
                        }))
                      }
                      data-testid="clv-qr"
                    />
                  </label>
                  {covariantError ? <div className="field-error">{covariantError}</div> : null}
                  <button
                    onClick={handleComputeCovariant}
                    disabled={runDisabled}
                    data-testid="clv-submit"
                  >
                    Compute Covariant Vectors
                  </button>
                </div>
              </InspectorDisclosure>

              <InspectorDisclosure
                key={`${selectionKey}-orbit-run`}
                title="Orbit Simulation"
                testId="orbit-run-toggle"
                defaultOpen={false}
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes before running orbits.
                    </div>
                  ) : null}
                  <div className="inspector-list">
                    {systemDraft.varNames.map((varName, index) => (
                      <label key={`orbit-ic-${index}`}>
                        Initial {varName}
                        <input
                          type="number"
                          value={orbitDraft.initialState[index] ?? '0'}
                          onChange={(event) =>
                            setOrbitDraft((prev) => {
                              const next = adjustArray(
                                prev.initialState,
                                systemDraft.varNames.length,
                                () => '0'
                              )
                              next[index] = event.target.value
                              return { ...prev, initialState: next }
                            })
                          }
                          data-testid={`orbit-run-ic-${index}`}
                        />
                      </label>
                    ))}
                  </div>
                  <label>
                    {systemDraft.type === 'map' ? 'Iterations' : 'Duration'}
                    <input
                      type="number"
                      value={orbitDraft.duration}
                      onChange={(event) =>
                        setOrbitDraft((prev) => ({ ...prev, duration: event.target.value }))
                      }
                      data-testid="orbit-run-duration"
                    />
                  </label>
                  {systemDraft.type === 'flow' ? (
                    <label>
                      Step size (dt)
                      <input
                        type="number"
                        value={orbitDraft.dt}
                        onChange={(event) =>
                          setOrbitDraft((prev) => ({ ...prev, dt: event.target.value }))
                        }
                        data-testid="orbit-run-dt"
                      />
                    </label>
                  ) : null}
                  {orbitError ? <div className="field-error">{orbitError}</div> : null}
                  <button
                    onClick={handleRunOrbit}
                    disabled={runDisabled}
                    data-testid="orbit-run-submit"
                  >
                    Run Orbit
                  </button>
                </div>
              </InspectorDisclosure>

              <InspectorDisclosure
                key={`${selectionKey}-limit-cycle-create`}
                title="Limit Cycle"
                testId="limit-cycle-toggle"
                defaultOpen={false}
              >
                <div className="inspector-section">
                  {systemDraft.type === 'map' ? (
                    <p className="empty-state">Limit cycles are only supported for flow systems.</p>
                  ) : null}
                  <label>
                    Name
                    <input
                      value={limitCycleDraft.name}
                      onChange={(event) =>
                        setLimitCycleDraft((prev) => ({ ...prev, name: event.target.value }))
                      }
                      placeholder={limitCycleNameSuggestion}
                      data-testid="limit-cycle-name"
                    />
                  </label>
                  <label>
                    Period
                    <input
                      type="number"
                      value={limitCycleDraft.period}
                      onChange={(event) =>
                        setLimitCycleDraft((prev) => ({ ...prev, period: event.target.value }))
                      }
                      data-testid="limit-cycle-period"
                    />
                  </label>
                  <div className="inspector-list">
                    {systemDraft.varNames.map((varName, index) => (
                      <label key={`lc-state-${index}`}>
                        State {varName}
                        <input
                          type="number"
                          value={limitCycleDraft.state[index] ?? '0'}
                          onChange={(event) =>
                            setLimitCycleDraft((prev) => {
                              const next = adjustArray(
                                prev.state,
                                systemDraft.varNames.length,
                                () => '0'
                              )
                              next[index] = event.target.value
                              return { ...prev, state: next }
                            })
                          }
                          data-testid={`limit-cycle-state-${index}`}
                        />
                      </label>
                    ))}
                  </div>
                  <label>
                    NTST
                    <input
                      type="number"
                      value={limitCycleDraft.ntst}
                      onChange={(event) =>
                        setLimitCycleDraft((prev) => ({ ...prev, ntst: event.target.value }))
                      }
                      data-testid="limit-cycle-ntst"
                    />
                  </label>
                  <label>
                    NCOL
                    <input
                      type="number"
                      value={limitCycleDraft.ncol}
                      onChange={(event) =>
                        setLimitCycleDraft((prev) => ({ ...prev, ncol: event.target.value }))
                      }
                      data-testid="limit-cycle-ncol"
                    />
                  </label>
                  {systemDraft.paramNames.length > 0 ? (
                    <label>
                      Continuation parameter
                      <select
                        value={limitCycleDraft.parameterName}
                        onChange={(event) =>
                          setLimitCycleDraft((prev) => ({
                            ...prev,
                            parameterName: event.target.value,
                          }))
                        }
                        data-testid="limit-cycle-parameter"
                      >
                        {systemDraft.paramNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {limitCycleError ? <div className="field-error">{limitCycleError}</div> : null}
                  <button
                    onClick={handleCreateLimitCycle}
                    disabled={runDisabled}
                    data-testid="limit-cycle-submit"
                  >
                    Create Limit Cycle
                  </button>
                </div>
              </InspectorDisclosure>

              <InspectorDisclosure
                key={`${selectionKey}-limit-cycle-orbit`}
                title="Limit Cycle from Orbit"
                testId="limit-cycle-from-orbit-toggle"
                defaultOpen={false}
              >
                <div className="inspector-section">
                  {systemDraft.type === 'map' ? (
                    <p className="empty-state">Limit cycles require a flow system.</p>
                  ) : null}
                  {systemDraft.paramNames.length === 0 ? (
                    <p className="empty-state">Add a parameter before continuing.</p>
                  ) : null}
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes before continuing.
                    </div>
                  ) : null}
                  {orbit && orbit.data.length === 0 ? (
                    <p className="empty-state">Run an orbit before continuing.</p>
                  ) : null}
                  {systemDraft.type === 'map' ||
                  systemDraft.paramNames.length === 0 ||
                  !orbit ||
                  orbit.data.length === 0 ? null : (
                    <>
                      <label>
                        Limit cycle name
                        <input
                          value={limitCycleFromOrbitDraft.limitCycleName}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              limitCycleName: event.target.value,
                            }))
                          }
                          placeholder={limitCycleFromOrbitNameSuggestion}
                          data-testid="limit-cycle-from-orbit-name"
                        />
                      </label>
                      <label>
                        Branch name
                        <input
                          value={limitCycleFromOrbitDraft.branchName}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              branchName: event.target.value,
                            }))
                          }
                          placeholder={limitCycleFromOrbitBranchSuggestion}
                          data-testid="limit-cycle-from-orbit-branch-name"
                        />
                      </label>
                      <label>
                        Continuation parameter
                        <select
                          value={limitCycleFromOrbitDraft.parameterName}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              parameterName: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-parameter"
                        >
                          {systemDraft.paramNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Cycle detection tolerance
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.tolerance}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              tolerance: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-tolerance"
                        />
                      </label>
                      <label>
                        NTST
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.ntst}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              ntst: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-ntst"
                        />
                      </label>
                      <label>
                        NCOL
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.ncol}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              ncol: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-ncol"
                        />
                      </label>
                      <label>
                        Direction
                        <select
                          value={limitCycleFromOrbitDraft.forward ? 'forward' : 'backward'}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              forward: event.target.value === 'forward',
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-direction"
                        >
                          <option value="forward">Forward (Increasing Param)</option>
                          <option value="backward">Backward (Decreasing Param)</option>
                        </select>
                      </label>
                      <label>
                        Initial step size
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.stepSize}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              stepSize: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-step-size"
                        />
                      </label>
                      <label>
                        Max points
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.maxSteps}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              maxSteps: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-max-steps"
                        />
                      </label>
                      <label>
                        Min step size
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.minStepSize}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              minStepSize: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-min-step-size"
                        />
                      </label>
                      <label>
                        Max step size
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.maxStepSize}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              maxStepSize: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-max-step-size"
                        />
                      </label>
                      <label>
                        Corrector steps
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.correctorSteps}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              correctorSteps: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-corrector-steps"
                        />
                      </label>
                      <label>
                        Corrector tolerance
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.correctorTolerance}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              correctorTolerance: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-corrector-tolerance"
                        />
                      </label>
                      <label>
                        Step tolerance
                        <input
                          type="number"
                          value={limitCycleFromOrbitDraft.stepTolerance}
                          onChange={(event) =>
                            setLimitCycleFromOrbitDraft((prev) => ({
                              ...prev,
                              stepTolerance: event.target.value,
                            }))
                          }
                          data-testid="limit-cycle-from-orbit-step-tolerance"
                        />
                      </label>
                      {limitCycleFromOrbitError ? (
                        <div className="field-error">{limitCycleFromOrbitError}</div>
                      ) : null}
                      <button
                        onClick={handleCreateLimitCycleFromOrbit}
                        disabled={
                          runDisabled ||
                          systemDraft.paramNames.length === 0 ||
                          orbit.data.length === 0
                        }
                        data-testid="limit-cycle-from-orbit-submit"
                      >
                        Continue Limit Cycle
                      </button>
                    </>
                  )}
                </div>
              </InspectorDisclosure>
            </>
          ) : null}

          {equilibrium ? (
            <>
              <InspectorDisclosure
                key={`${selectionKey}-equilibrium-data`}
                title="Equilibrium Data"
                testId="equilibrium-data-toggle"
              >
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Summary</h4>
                  <InspectorMetrics
                    rows={[
                      { label: 'System', value: equilibrium.systemName },
                    ]}
                  />
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Coordinates</h4>
                  {equilibrium.solution ? (
                    <InspectorMetrics
                      rows={systemDraft.varNames.map((name, index) => ({
                        label: name || `x${index + 1}`,
                        value: formatNumber(equilibrium.solution?.state[index] ?? Number.NaN, 6),
                      }))}
                    />
                  ) : (
                    <p className="empty-state">No stored equilibrium solution yet.</p>
                  )}
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Parameters (last solve)</h4>
                  {equilibrium.parameters && equilibrium.parameters.length > 0 ? (
                    <InspectorMetrics
                      rows={equilibrium.parameters.map((value, index) => ({
                        label: systemDraft.paramNames[index] || `p${index + 1}`,
                        value: formatNumber(value, 6),
                      }))}
                    />
                  ) : (
                    <p className="empty-state">Parameters not recorded yet.</p>
                  )}
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Residual and iterations</h4>
                  {equilibrium.solution ? (
                    <InspectorMetrics
                      rows={[
                        {
                          label: 'Residual',
                          value: formatScientific(equilibrium.solution.residual_norm, 6),
                        },
                        {
                          label: 'Iterations',
                          value: equilibrium.solution.iterations,
                        },
                      ]}
                    />
                  ) : (
                    <p className="empty-state">No residual available until solved.</p>
                  )}
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Eigenpairs</h4>
                  {equilibrium.solution && equilibrium.solution.eigenpairs.length > 0 ? (
                    <div className="inspector-list">
                      {!equilibriumHasEigenvectors ? (
                        <p className="empty-state">Eigenvectors not computed yet.</p>
                      ) : null}
                      {equilibriumNeeds2d ? (
                        <div className="field-warning">
                          Eigenvector plotting requires at least two state variables.
                        </div>
                      ) : null}
                      <label>
                        Show eigenvectors
                        <input
                          type="checkbox"
                          checked={equilibriumEigenvectorRender.enabled}
                          onChange={(event) =>
                            updateEquilibriumEigenvectorRender({
                              enabled: event.target.checked,
                            })
                          }
                          data-testid="equilibrium-eigenvector-enabled"
                        />
                      </label>
                      <label>
                        Eigenline length (fraction of scene)
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={equilibriumEigenvectorRender.lineLengthScale}
                          onChange={(event) =>
                            updateEquilibriumEigenvectorRender({
                              lineLengthScale: Number(event.target.value),
                            })
                          }
                          data-testid="equilibrium-eigenvector-line-length"
                        />
                      </label>
                      <label>
                        Eigenline thickness (px)
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={equilibriumEigenvectorRender.lineThickness}
                          onChange={(event) =>
                            updateEquilibriumEigenvectorRender({
                              lineThickness: Number(event.target.value),
                            })
                          }
                          data-testid="equilibrium-eigenvector-line-thickness"
                        />
                      </label>
                      <label>
                        Eigenspace disc radius (fraction of scene)
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={equilibriumEigenvectorRender.discRadiusScale}
                          onChange={(event) =>
                            updateEquilibriumEigenvectorRender({
                              discRadiusScale: Number(event.target.value),
                            })
                          }
                          data-testid="equilibrium-eigenvector-disc-radius"
                        />
                      </label>
                      <label>
                        Eigenspace disc thickness (px)
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={equilibriumEigenvectorRender.discThickness}
                          onChange={(event) =>
                            updateEquilibriumEigenvectorRender({
                              discThickness: Number(event.target.value),
                            })
                          }
                          data-testid="equilibrium-eigenvector-disc-thickness"
                        />
                      </label>
                      {equilibriumEigenvectorIndices.length > 0 ? (
                        <div className="inspector-list">
                          {equilibriumEigenvectorIndices.map((index, idx) => {
                            const pair = equilibriumEigenpairs[index]
                            const label =
                              pair && !isRealEigenvalue(pair.value)
                                ? `Eigenspace ${index + 1}`
                                : `Eigenvector ${index + 1}`
                            const visible = equilibriumEigenvectorVisibleSet.has(index)
                            return (
                              <div className="clv-control-row" key={`eq-eigen-color-${index}`}>
                                <span className="clv-control-row__label">{label}</span>
                                <input
                                  type="checkbox"
                                  checked={visible}
                                  onChange={(event) =>
                                    handleEquilibriumEigenvectorVisibilityChange(
                                      index,
                                      event.target.checked
                                    )
                                  }
                                  aria-label={`Show ${label.toLowerCase()}`}
                                  data-testid={`equilibrium-eigenvector-show-${index}`}
                                />
                                <input
                                  type="color"
                                  value={equilibriumEigenvectorColors[idx]}
                                  onChange={(event) =>
                                    handleEquilibriumEigenvectorColorChange(
                                      index,
                                      event.target.value
                                    )
                                  }
                                  disabled={!visible}
                                  aria-label={`${label} color`}
                                  data-testid={`equilibrium-eigenvector-color-${index}`}
                                />
                              </div>
                            )
                          })}
                        </div>
                      ) : null}
                      {/* Mirror the legacy UI by plotting eigenvalues in the complex plane. */}
                      {equilibriumEigenPlot ? (
                        <div className="inspector-plot">
                          <PlotlyViewport
                            data={equilibriumEigenPlot.data}
                            layout={equilibriumEigenPlot.layout}
                            testId="equilibrium-eigenvalue-plot"
                          />
                        </div>
                      ) : null}
                      {equilibrium.solution.eigenpairs.map((pair, pairIndex) => (
                        <div
                          className="inspector-subsection inspector-eigenpair"
                          key={`eq-eigen-${pairIndex}`}
                        >
                          <div className="inspector-eigenpair__header">
                            <span className="inspector-subheading">
                              Eigenpair {pairIndex + 1}
                            </span>
                            <span className="inspector-eigenpair__value">
                              <span className="inspector-eigenpair__value-label">Value</span>
                              <span className="inspector-eigenpair__value-number">
                                {formatComplexValue(pair.value)}
                                {isDiscreteMap
                                  ? ` (${formatPolarValue(pair.value, 4)})`
                                  : null}
                              </span>
                            </span>
                          </div>
                          {pair.vector.length > 0 ? (
                            <div className="inspector-eigenvector">
                              {pair.vector.map((entry, vectorIndex) => (
                                <div
                                  className="inspector-eigenvector__entry"
                                  key={`eq-eigen-${pairIndex}-${vectorIndex}`}
                                >
                                  <span className="inspector-eigenvector__label">
                                    {systemDraft.varNames[vectorIndex] ||
                                      `v${pairIndex + 1}_${vectorIndex + 1}`}
                                  </span>
                                  <span className="inspector-eigenvector__value">
                                    {formatComplexValue(entry)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="empty-state">No eigenvector components stored.</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state">No eigenpairs available yet.</p>
                  )}
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Last solver attempt</h4>
                  {equilibrium.lastRun ? (
                    <InspectorMetrics
                      rows={[
                        { label: 'Timestamp', value: equilibrium.lastRun.timestamp },
                        {
                          label: 'Result',
                          value: equilibrium.lastRun.success ? 'Success' : 'Failed',
                        },
                        ...(equilibrium.lastRun.residual_norm !== undefined
                          ? [
                              {
                                label: 'Residual',
                                value: formatScientific(equilibrium.lastRun.residual_norm, 6),
                              },
                            ]
                          : []),
                        ...(equilibrium.lastRun.iterations !== undefined
                          ? [
                              {
                                label: 'Iterations',
                                value: equilibrium.lastRun.iterations,
                              },
                            ]
                          : []),
                      ]}
                    />
                  ) : (
                    <p className="empty-state">Solver has not been run yet.</p>
                  )}
                </div>
                <div className="inspector-section">
                  <h4 className="inspector-subheading">Cached solver parameters</h4>
                  {equilibrium.lastSolverParams ? (
                    <>
                      <InspectorMetrics
                        rows={[
                          {
                            label: 'Max steps',
                            value: equilibrium.lastSolverParams.maxSteps,
                          },
                          {
                            label: 'Damping',
                            value: formatNumber(
                              equilibrium.lastSolverParams.dampingFactor,
                              4
                            ),
                          },
                        ]}
                      />
                      <InspectorMetrics
                        rows={systemDraft.varNames.map((name, index) => ({
                          label: name || `x${index + 1}`,
                          value: formatNumber(
                            equilibrium.lastSolverParams?.initialGuess[index] ?? Number.NaN,
                            6
                          ),
                        }))}
                      />
                    </>
                  ) : (
                    <p className="empty-state">No cached solver parameters yet.</p>
                  )}
                </div>
              </InspectorDisclosure>

              <InspectorDisclosure
                key={`${selectionKey}-equilibrium-solver`}
                title="Equilibrium Solver"
                testId="equilibrium-solver-toggle"
                defaultOpen={false}
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes before solving equilibria.
                    </div>
                  ) : null}
                  <div className="inspector-list">
                    {systemDraft.varNames.map((varName, index) => (
                      <label key={`eq-guess-${index}`}>
                        Initial {varName}
                        <input
                          type="number"
                          value={equilibriumDraft.initialGuess[index] ?? '0'}
                          onChange={(event) =>
                            setEquilibriumDraft((prev) => {
                              const next = adjustArray(
                                prev.initialGuess,
                                systemDraft.varNames.length,
                                () => '0'
                              )
                              next[index] = event.target.value
                              return { ...prev, initialGuess: next }
                            })
                          }
                          data-testid={`equilibrium-solve-guess-${index}`}
                        />
                      </label>
                    ))}
                  </div>
                  <label>
                    Max steps
                    <input
                      type="number"
                      value={equilibriumDraft.maxSteps}
                      onChange={(event) =>
                        setEquilibriumDraft((prev) => ({ ...prev, maxSteps: event.target.value }))
                      }
                      data-testid="equilibrium-solve-steps"
                    />
                  </label>
                  <label>
                    Damping
                    <input
                      type="number"
                      value={equilibriumDraft.dampingFactor}
                      onChange={(event) =>
                        setEquilibriumDraft((prev) => ({
                          ...prev,
                          dampingFactor: event.target.value,
                        }))
                      }
                      data-testid="equilibrium-solve-damping"
                    />
                  </label>
                  {equilibriumError ? <div className="field-error">{equilibriumError}</div> : null}
                  <button
                    onClick={handleSolveEquilibrium}
                    disabled={runDisabled}
                    data-testid="equilibrium-solve-submit"
                  >
                    Solve Equilibrium
                  </button>
                </div>
              </InspectorDisclosure>

              <InspectorDisclosure
                key={`${selectionKey}-equilibrium-continuation`}
                title="Equilibrium Continuation"
                testId="equilibrium-continuation-toggle"
                defaultOpen={false}
              >
                <div className="inspector-section">
                  {runDisabled ? (
                    <div className="field-warning">
                      Apply valid system changes before continuing.
                    </div>
                  ) : null}
                  {systemDraft.paramNames.length === 0 ? (
                    <p className="empty-state">Add parameters to enable continuation.</p>
                  ) : null}
                  {!equilibrium.solution ? (
                    <p className="empty-state">Solve the equilibrium to continue it.</p>
                  ) : (
                    <>
                      <label>
                        Branch name
                        <input
                          value={continuationDraft.name}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              name: event.target.value,
                            }))
                          }
                          placeholder={
                            continuationDraft.parameterName
                              ? `${toCliSafeName(equilibrium.name)}_${toCliSafeName(continuationDraft.parameterName)}`
                              : toCliSafeName(equilibrium.name)
                          }
                          data-testid="equilibrium-branch-name"
                        />
                      </label>
                      <label>
                        Continuation parameter
                        <select
                          value={continuationDraft.parameterName}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              parameterName: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-parameter"
                        >
                          {systemDraft.paramNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Direction
                        <select
                          value={continuationDraft.forward ? 'forward' : 'backward'}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              forward: event.target.value === 'forward',
                            }))
                          }
                          data-testid="equilibrium-branch-direction"
                        >
                          <option value="forward">Forward (Increasing Param)</option>
                          <option value="backward">Backward (Decreasing Param)</option>
                        </select>
                      </label>
                      <label>
                        Initial step size
                        <input
                          type="number"
                          value={continuationDraft.stepSize}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              stepSize: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-step-size"
                        />
                      </label>
                      <label>
                        Max points
                        <input
                          type="number"
                          value={continuationDraft.maxSteps}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              maxSteps: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-max-steps"
                        />
                      </label>
                      <label>
                        Min step size
                        <input
                          type="number"
                          value={continuationDraft.minStepSize}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              minStepSize: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-min-step"
                        />
                      </label>
                      <label>
                        Max step size
                        <input
                          type="number"
                          value={continuationDraft.maxStepSize}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              maxStepSize: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-max-step"
                        />
                      </label>
                      <label>
                        Corrector steps
                        <input
                          type="number"
                          value={continuationDraft.correctorSteps}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              correctorSteps: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-corrector-steps"
                        />
                      </label>
                      <label>
                        Corrector tolerance
                        <input
                          type="number"
                          value={continuationDraft.correctorTolerance}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              correctorTolerance: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-corrector-tolerance"
                        />
                      </label>
                      <label>
                        Step tolerance
                        <input
                          type="number"
                          value={continuationDraft.stepTolerance}
                          onChange={(event) =>
                            setContinuationDraft((prev) => ({
                              ...prev,
                              stepTolerance: event.target.value,
                            }))
                          }
                          data-testid="equilibrium-branch-step-tolerance"
                        />
                      </label>
                      {continuationError ? (
                        <div className="field-error">{continuationError}</div>
                      ) : null}
                      <button
                        onClick={handleCreateEquilibriumBranch}
                        disabled={runDisabled}
                        data-testid="equilibrium-branch-submit"
                      >
                        Create Branch
                      </button>
                    </>
                  )}
                </div>
              </InspectorDisclosure>
            </>
          ) : null}

          {limitCycle ? (
            <InspectorDisclosure
              key={`${selectionKey}-limit-cycle-data`}
              title="Limit Cycle Data"
              testId="limit-cycle-data-toggle"
            >
              <div className="inspector-section">
                <h4 className="inspector-subheading">Summary</h4>
                <InspectorMetrics
                  rows={[
                    { label: 'System', value: limitCycle.systemName },
                    { label: 'Mesh', value: `${limitCycle.ntst} x ${limitCycle.ncol}` },
                    { label: 'Period', value: formatNumber(limitCycle.period, 6) },
                    { label: 'Continuation param', value: limitCycle.parameterName ?? 'n/a' },
                    {
                      label: 'Parameter value',
                      value:
                        limitCycle.paramValue !== undefined
                          ? formatNumber(limitCycle.paramValue, 6)
                          : 'n/a',
                    },
                    { label: 'Origin', value: formatLimitCycleOrigin(limitCycle.origin) },
                    { label: 'Created', value: limitCycle.createdAt },
                  ]}
                />
              </div>
              <div className="inspector-section">
                <h4 className="inspector-subheading">Parameters</h4>
                {limitCycle.parameters && limitCycle.parameters.length > 0 ? (
                  <InspectorMetrics
                    rows={limitCycle.parameters.map((value, index) => ({
                      label: systemDraft.paramNames[index] || `p${index + 1}`,
                      value: formatNumber(value, 6),
                    }))}
                  />
                ) : (
                  <p className="empty-state">Parameters not recorded yet.</p>
                )}
              </div>
              <div className="inspector-section">
                <h4 className="inspector-subheading">State</h4>
                {limitCycle.state.length > 0 ? (
                  <div className="inspector-data">
                    <div>Length: {limitCycle.state.length}</div>
                    <div>
                      Preview: [
                      {limitCycle.state
                        .slice(0, Math.min(limitCycle.state.length, 8))
                        .map((value) => formatFixed(value, 4))
                        .join(', ')}
                      {limitCycle.state.length > 8 ? ', ...' : ''}]
                    </div>
                  </div>
                ) : (
                  <p className="empty-state">No state stored yet.</p>
                )}
              </div>
              <div className="inspector-section">
                <h4 className="inspector-subheading">Floquet multipliers</h4>
                {limitCycle.floquetMultipliers && limitCycle.floquetMultipliers.length > 0 ? (
                  <InspectorMetrics
                    rows={limitCycle.floquetMultipliers.map((value, index) => ({
                      label: `Multiplier ${index + 1}`,
                      value: formatComplexValue(value),
                    }))}
                  />
                ) : (
                  <p className="empty-state">Floquet multipliers not computed yet.</p>
                )}
              </div>
            </InspectorDisclosure>
          ) : null}

          {scene ? (
            <div className="inspector-section">
              <h3>Scene</h3>
              <label>
                Fallback display
                <select
                  value={scene.display}
                  onChange={(event) =>
                    onUpdateScene(scene.id, {
                      display: event.target.value as Scene['display'],
                    })
                  }
                  data-testid="scene-display"
                >
                  <option value="all">All visible objects</option>
                  <option value="selection">Selected object</option>
                </select>
              </label>
              <p className="empty-state">Used when no objects are selected below.</p>
              <div className="inspector-subsection">
                <h4 className="inspector-subheading">Displayed objects</h4>
                <label>
                  Search objects
                  <input
                    value={sceneSearch}
                    onChange={(event) => setSceneSearch(event.target.value)}
                    placeholder="Type to filter…"
                    data-testid="scene-object-search"
                  />
                </label>
                {sceneSelectedEntries.length > 0 ? (
                  <div className="scene-object-selected">
                    {sceneSelectedEntries.map((entry) => (
                      <div className="scene-object-selected__row" key={`scene-sel-${entry.id}`}>
                        <div className="scene-object-selected__info">
                          <span>{entry.name}</span>
                          <span className="scene-object-selected__meta">
                            {entry.type.replace('_', ' ')}
                            {entry.visible ? '' : ' · hidden'}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="scene-object-selected__remove"
                          onClick={() => {
                            const next = sceneSelectedIds.filter((id) => id !== entry.id)
                            onUpdateScene(scene.id, { selectedNodeIds: next })
                          }}
                          aria-label={`Remove ${entry.name} from scene`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state">
                    No objects selected yet. Use the list below to add objects to this scene.
                  </p>
                )}
                {sceneFilteredObjects.length > 0 ? (
                  <div className="scene-object-list">
                    {sceneFilteredObjects.map((entry) => {
                      const checked = sceneSelectedSet.has(entry.id)
                      return (
                        <label
                          key={`scene-entry-${entry.id}`}
                          className="scene-object-row"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const next = checked
                                ? sceneSelectedIds.filter((id) => id !== entry.id)
                                : [...sceneSelectedIds, entry.id]
                              onUpdateScene(scene.id, { selectedNodeIds: next })
                            }}
                          />
                          <span className="scene-object-row__name">{entry.name}</span>
                          <span className="scene-object-row__meta">
                            {entry.type.replace('_', ' ')}
                            {entry.visible ? '' : ' · hidden'}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <p className="empty-state">No objects match this search.</p>
                )}
              </div>
            </div>
          ) : null}

          {diagram ? (
            <div className="inspector-section">
              <h3>Bifurcation Diagram</h3>
              {axisOptions.length > 0 ? (
                <>
                  <label>
                    Abscissa
                    <select
                      value={formatAxisValue(diagram.xAxis)}
                      onChange={(event) =>
                        onUpdateBifurcationDiagram(diagram.id, {
                          xAxis: parseAxisValue(event.target.value),
                        })
                      }
                      data-testid="diagram-x-param"
                    >
                      <option value="">Unassigned</option>
                      {axisOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Ordinate
                    <select
                      value={formatAxisValue(diagram.yAxis)}
                      onChange={(event) =>
                        onUpdateBifurcationDiagram(diagram.id, {
                          yAxis: parseAxisValue(event.target.value),
                        })
                      }
                      data-testid="diagram-y-param"
                    >
                      <option value="">Unassigned</option>
                      {axisOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <p className="empty-state">
                  Add parameters or state space variables to configure axes.
                </p>
              )}
              {branchEntries.length > 0 ? (
                <div className="inspector-subsection">
                  <h4 className="inspector-subheading">Displayed branches</h4>
                  <label>
                    Search branches
                    <input
                      value={diagramSearch}
                      onChange={(event) => setDiagramSearch(event.target.value)}
                      placeholder="Type to filter…"
                      data-testid="diagram-branch-search"
                    />
                  </label>
                  {diagramSelectedEntries.length > 0 ? (
                    <div className="scene-object-selected">
                      {diagramSelectedEntries.map((entry) => (
                        <div
                          className="scene-object-selected__row"
                          key={`diagram-sel-${entry.id}`}
                        >
                          <div className="scene-object-selected__info">
                            <span>{entry.name}</span>
                            <span className="scene-object-selected__meta">
                              {entry.type} · {entry.points} points
                              {entry.visible ? '' : ' · hidden'}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="scene-object-selected__remove"
                            onClick={() => {
                              const next = diagramSelectedIds.filter((id) => id !== entry.id)
                              onUpdateBifurcationDiagram(diagram.id, {
                                selectedBranchIds: next,
                              })
                            }}
                            aria-label={`Remove ${entry.name} from diagram`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state">
                      No branches selected yet. Use the list below to add branches to this
                      diagram.
                    </p>
                  )}
                  {diagramFilteredBranches.length > 0 ? (
                    <div className="scene-object-list">
                      {diagramFilteredBranches.map((entry) => {
                        const checked = diagramSelectedSet.has(entry.id)
                        return (
                          <label
                            key={`diagram-entry-${entry.id}`}
                            className="scene-object-row"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const next = checked
                                  ? diagramSelectedIds.filter((id) => id !== entry.id)
                                  : [...diagramSelectedIds, entry.id]
                                onUpdateBifurcationDiagram(diagram.id, {
                                  selectedBranchIds: next,
                                })
                              }}
                            />
                            <span className="scene-object-row__name">{entry.name}</span>
                            <span className="scene-object-row__meta">
                              {entry.type} · {entry.points} points
                              {entry.visible ? '' : ' · hidden'}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="empty-state">No branches match this search.</p>
                  )}
                </div>
              ) : (
                <p className="empty-state">No branches available yet.</p>
              )}
            </div>
          ) : null}

            {branch ? (
              <>
                <InspectorDisclosure
                  key={`${selectionKey}-branch-summary`}
                  title="Branch Summary"
                  testId="branch-summary-toggle"
                >
                  <div className="inspector-section">
                    <InspectorMetrics
                      rows={[
                        { label: 'Type', value: formatBranchType(branch) },
                        { label: 'Parent', value: branch.parentObject },
                        { label: 'Start', value: branch.startObject },
                        { label: 'Continuation param', value: branch.parameterName },
                        { label: 'Points', value: branch.data.points.length },
                        { label: 'Bifurcations', value: branchBifurcations.length },
                        ...(branchStartPoint
                          ? [
                              {
                                label: 'Start param value',
                                value: formatNumber(branchStartPoint.param_value, 6),
                              },
                            ]
                          : []),
                        ...(branchEndPoint
                          ? [
                              {
                                label: 'End param value',
                                value: formatNumber(branchEndPoint.param_value, 6),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </div>
                  {branch.settings && typeof branch.settings === 'object' ? (
                    <div className="inspector-section">
                      <h4 className="inspector-subheading">Continuation settings</h4>
                      <InspectorMetrics
                        rows={[
                          {
                            label: 'Step size',
                            value: formatNumber(
                              (branch.settings as { step_size?: number }).step_size ??
                                Number.NaN,
                              6
                            ),
                          },
                          {
                            label: 'Min step',
                            value: formatNumber(
                              (branch.settings as { min_step_size?: number }).min_step_size ??
                                Number.NaN,
                              6
                            ),
                          },
                          {
                            label: 'Max step',
                            value: formatNumber(
                              (branch.settings as { max_step_size?: number }).max_step_size ??
                                Number.NaN,
                              6
                            ),
                          },
                          {
                            label: 'Max points',
                            value:
                              (branch.settings as { max_steps?: number }).max_steps ??
                              Number.NaN,
                          },
                          {
                            label: 'Corrector steps',
                            value:
                              (branch.settings as { corrector_steps?: number })
                                .corrector_steps ?? Number.NaN,
                          },
                          {
                            label: 'Corrector tol',
                            value: formatScientific(
                              (branch.settings as { corrector_tolerance?: number })
                                .corrector_tolerance ?? Number.NaN,
                              4
                            ),
                          },
                          {
                            label: 'Step tol',
                            value: formatScientific(
                              (branch.settings as { step_tolerance?: number }).step_tolerance ??
                                Number.NaN,
                              4
                            ),
                          },
                        ]}
                      />
                    </div>
                  ) : null}
                </InspectorDisclosure>

                <InspectorDisclosure
                  key={`${selectionKey}-branch-points`}
                  title="Branch Points"
                  testId="branch-points-toggle"
                  defaultOpen={false}
                >
                  <div className="inspector-section">
                    {branch.data.points.length === 0 ? (
                      <p className="empty-state">No branch points stored yet.</p>
                    ) : (
                      <>
                        <div className="inspector-row">
                          <button
                            type="button"
                            onClick={() => {
                              if (branchPointIndex === null) return
                              const sortedIndex = branchSortedOrder.indexOf(branchPointIndex)
                              if (sortedIndex <= 0) return
                              setBranchPoint(branchSortedOrder[sortedIndex - 1])
                            }}
                            disabled={
                              branchPointIndex === null ||
                              branchSortedOrder.indexOf(branchPointIndex) <= 0
                            }
                            data-testid="branch-point-prev"
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (branchPointIndex === null) return
                              const sortedIndex = branchSortedOrder.indexOf(branchPointIndex)
                              if (sortedIndex < 0 || sortedIndex >= branchSortedOrder.length - 1)
                                return
                              setBranchPoint(branchSortedOrder[sortedIndex + 1])
                            }}
                            disabled={
                              branchPointIndex === null ||
                              branchSortedOrder.indexOf(branchPointIndex) >=
                                branchSortedOrder.length - 1
                            }
                            data-testid="branch-point-next"
                          >
                            Next
                          </button>
                        </div>

                        <label>
                          Logical index
                          <div className="inspector-row">
                            <input
                              type="number"
                              value={branchPointInput}
                              onChange={(event) => setBranchPointInput(event.target.value)}
                              data-testid="branch-point-input"
                            />
                            <button
                              type="button"
                              onClick={handleJumpToBranchPoint}
                              data-testid="branch-point-jump"
                            >
                              Jump
                            </button>
                          </div>
                        </label>
                        {branchPointError ? (
                          <div className="field-error">{branchPointError}</div>
                        ) : null}

                        {branchPointIndex !== null ? (
                          <div className="inspector-data">
                            <div>
                              Selected point: logical {branchIndices[branchPointIndex]} (array{' '}
                              {branchPointIndex})
                            </div>
                            {selectedBranchPoint ? (
                              <>
                                <div>Stability: {selectedBranchPoint.stability}</div>
                                <div>
                                  {summarizeEigenvalues(selectedBranchPoint, branch.branchType)}
                                </div>
                              </>
                            ) : null}
                          </div>
                        ) : null}

                        {branchBifurcations.length > 0 ? (
                          <div className="inspector-section">
                            <h4 className="inspector-subheading">Bifurcations</h4>
                            <div className="inspector-list">
                              {branchBifurcations.map((idx) => {
                                const logical = branchIndices[idx]
                                const point = branch?.data.points[idx]
                                const displayIndex = Number.isFinite(logical) ? logical : idx
                                const label = formatBifurcationLabel(
                                  displayIndex,
                                  point?.stability
                                )
                                return (
                                  <button
                                    type="button"
                                    key={`bif-${idx}`}
                                    onClick={() => setBranchPoint(idx)}
                                    data-testid={`branch-bifurcation-${idx}`}
                                  >
                                    {label}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </InspectorDisclosure>

                <InspectorDisclosure
                  key={`${selectionKey}-branch-point-details`}
                  title="Point Details"
                  testId="branch-point-details-toggle"
                >
                  <div className="inspector-section">
                    {selectedBranchPoint ? (
                      <>
                        <InspectorMetrics
                          rows={[
                            { label: 'Stability', value: selectedBranchPoint.stability },
                          ]}
                        />
                        <h4 className="inspector-subheading">Parameters</h4>
                        <InspectorMetrics
                          rows={systemDraft.paramNames.map((name, index) => {
                            let value = branchParams[index]
                            if (codim1ParamNames) {
                              if (name === codim1ParamNames.param1) {
                                value = selectedBranchPoint.param_value
                              } else if (name === codim1ParamNames.param2) {
                                value =
                                  selectedBranchPoint.param2_value ?? branchParams[index]
                              }
                            } else if (index === continuationParamIndex) {
                              value = selectedBranchPoint.param_value
                            }
                            return {
                              label: name || `p${index + 1}`,
                              value: formatNumber(value ?? Number.NaN, 6),
                            }
                          })}
                        />
                        <h4 className="inspector-subheading">State</h4>
                        <InspectorMetrics
                          rows={systemDraft.varNames.map((name, index) => ({
                            label: name || `x${index + 1}`,
                            value: formatNumber(
                              selectedBranchPoint.state[index] ?? Number.NaN,
                              6
                            ),
                          }))}
                        />
                        <h4 className="inspector-subheading">Eigenvalues</h4>
                        {branchEigenvalues.length > 0 ? (
                          <div className="inspector-list">
                            {branchEigenPlot ? (
                              <div className="inspector-plot">
                                <PlotlyViewport
                                  data={branchEigenPlot.data}
                                  layout={branchEigenPlot.layout}
                                  testId="branch-eigenvalue-plot"
                                />
                              </div>
                            ) : null}
                            <InspectorMetrics
                              rows={branchEigenvalues.map((ev, index) => ({
                                label: `λ${index + 1}`,
                                value: isDiscreteMap
                                  ? `${formatNumberSafe(ev.re)} + ${formatNumberSafe(ev.im)}i (${formatPolarValue(ev)})`
                                  : `${formatNumberSafe(ev.re)} + ${formatNumberSafe(ev.im)}i`,
                              }))}
                            />
                          </div>
                        ) : (
                          <p className="empty-state">No eigenvalues stored for this point.</p>
                        )}
                      </>
                    ) : (
                      <p className="empty-state">Select a point to inspect.</p>
                    )}
                  </div>
                </InspectorDisclosure>

                <InspectorDisclosure
                  key={`${selectionKey}-branch-extend`}
                  title="Extend Branch"
                  testId="branch-extend-toggle"
                  defaultOpen={false}
                >
                  <div className="inspector-section">
                    {!canExtendBranch ? (
                      <p className="empty-state">
                        Branch extension is only available for equilibrium, limit cycle, or bifurcation curve branches.
                      </p>
                    ) : null}
                    {runDisabled ? (
                      <div className="field-warning">
                        Apply valid system changes before extending.
                      </div>
                    ) : null}
                    <label>
                      Direction
                      <select
                        value={branchExtensionDraft.forward ? 'forward' : 'backward'}
                        onChange={(event) =>
                          setBranchExtensionDraft((prev) => ({
                            ...prev,
                            forward: event.target.value === 'forward',
                          }))
                        }
                        disabled={!canExtendBranch}
                        data-testid="branch-extend-direction"
                      >
                        <option value="forward">Forward (Append)</option>
                        <option value="backward">Backward (Prepend)</option>
                      </select>
                    </label>
                    <label>
                      Max points to add
                      <input
                        type="number"
                        value={branchExtensionDraft.maxSteps}
                        onChange={(event) =>
                          setBranchExtensionDraft((prev) => ({
                            ...prev,
                            maxSteps: event.target.value,
                          }))
                        }
                        disabled={!canExtendBranch}
                        data-testid="branch-extend-max-steps"
                      />
                    </label>
                    <label>
                      Step size
                      <input
                        type="number"
                        value={branchExtensionDraft.stepSize}
                        onChange={(event) =>
                          setBranchExtensionDraft((prev) => ({
                            ...prev,
                            stepSize: event.target.value,
                          }))
                        }
                        disabled={!canExtendBranch}
                        data-testid="branch-extend-step-size"
                      />
                    </label>
                    <label>
                      Min step size
                      <input
                        type="number"
                        value={branchExtensionDraft.minStepSize}
                        onChange={(event) =>
                          setBranchExtensionDraft((prev) => ({
                            ...prev,
                            minStepSize: event.target.value,
                          }))
                        }
                        disabled={!canExtendBranch}
                        data-testid="branch-extend-min-step"
                      />
                    </label>
                    <label>
                      Max step size
                      <input
                        type="number"
                        value={branchExtensionDraft.maxStepSize}
                        onChange={(event) =>
                          setBranchExtensionDraft((prev) => ({
                            ...prev,
                            maxStepSize: event.target.value,
                          }))
                        }
                        disabled={!canExtendBranch}
                        data-testid="branch-extend-max-step"
                      />
                    </label>
                    <label>
                      Corrector steps
                      <input
                        type="number"
                        value={branchExtensionDraft.correctorSteps}
                        onChange={(event) =>
                          setBranchExtensionDraft((prev) => ({
                            ...prev,
                            correctorSteps: event.target.value,
                          }))
                        }
                        disabled={!canExtendBranch}
                        data-testid="branch-extend-corrector-steps"
                      />
                    </label>
                    <label>
                      Corrector tolerance
                      <input
                        type="number"
                        value={branchExtensionDraft.correctorTolerance}
                        onChange={(event) =>
                          setBranchExtensionDraft((prev) => ({
                            ...prev,
                            correctorTolerance: event.target.value,
                          }))
                        }
                        disabled={!canExtendBranch}
                        data-testid="branch-extend-corrector-tolerance"
                      />
                    </label>
                    <label>
                      Step tolerance
                      <input
                        type="number"
                        value={branchExtensionDraft.stepTolerance}
                        onChange={(event) =>
                          setBranchExtensionDraft((prev) => ({
                            ...prev,
                            stepTolerance: event.target.value,
                          }))
                        }
                        disabled={!canExtendBranch}
                        data-testid="branch-extend-step-tolerance"
                      />
                    </label>
                    {branchExtensionError ? (
                      <div className="field-error">{branchExtensionError}</div>
                    ) : null}
                    <button
                      onClick={handleExtendBranch}
                      disabled={runDisabled || !canExtendBranch}
                      data-testid="branch-extend-submit"
                    >
                      Extend Branch
                    </button>
                  </div>
                </InspectorDisclosure>

                <InspectorDisclosure
                  key={`${selectionKey}-branch-continue`}
                  title="Continue From Point"
                  testId="branch-continue-toggle"
                  defaultOpen={false}
                >
                  <div className="inspector-section">
                    {branch.branchType !== 'equilibrium' ? (
                      <p className="empty-state">
                        Continuation from points is only available for equilibrium branches.
                      </p>
                    ) : null}
                    {runDisabled ? (
                      <div className="field-warning">
                        Apply valid system changes before continuing.
                      </div>
                    ) : null}
                    {systemDraft.paramNames.length === 0 ? (
                      <p className="empty-state">Add parameters to enable continuation.</p>
                    ) : null}
                    <label>
                      Branch name
                      <input
                        value={branchContinuationDraft.name}
                        onChange={(event) =>
                          setBranchContinuationDraft((prev) => ({
                            ...prev,
                            name: event.target.value,
                          }))
                        }
                        placeholder={
                          branchContinuationDraft.parameterName
                            ? `${toCliSafeName(branch.name)}_${toCliSafeName(branchContinuationDraft.parameterName)}`
                            : toCliSafeName(branch.name)
                        }
                        data-testid="branch-from-point-name"
                      />
                    </label>
                    <label>
                      Continuation parameter
                      <select
                        value={branchContinuationDraft.parameterName}
                        onChange={(event) =>
                          setBranchContinuationDraft((prev) => ({
                            ...prev,
                            parameterName: event.target.value,
                          }))
                        }
                        data-testid="branch-from-point-parameter"
                      >
                        {systemDraft.paramNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                            {name === branch.parameterName ? ' (current)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Direction
                      <select
                        value={branchContinuationDraft.forward ? 'forward' : 'backward'}
                        onChange={(event) =>
                          setBranchContinuationDraft((prev) => ({
                            ...prev,
                            forward: event.target.value === 'forward',
                          }))
                        }
                        data-testid="branch-from-point-direction"
                      >
                        <option value="forward">Forward (Increasing Param)</option>
                        <option value="backward">Backward (Decreasing Param)</option>
                      </select>
                    </label>
                    <label>
                      Initial step size
                      <input
                        type="number"
                        value={branchContinuationDraft.stepSize}
                        onChange={(event) =>
                          setBranchContinuationDraft((prev) => ({
                            ...prev,
                            stepSize: event.target.value,
                          }))
                        }
                        data-testid="branch-from-point-step-size"
                      />
                    </label>
                    <label>
                      Max points
                      <input
                        type="number"
                        value={branchContinuationDraft.maxSteps}
                        onChange={(event) =>
                          setBranchContinuationDraft((prev) => ({
                            ...prev,
                            maxSteps: event.target.value,
                          }))
                        }
                        data-testid="branch-from-point-max-steps"
                      />
                    </label>
                    <label>
                      Min step size
                      <input
                        type="number"
                        value={branchContinuationDraft.minStepSize}
                        onChange={(event) =>
                          setBranchContinuationDraft((prev) => ({
                            ...prev,
                            minStepSize: event.target.value,
                          }))
                        }
                        data-testid="branch-from-point-min-step"
                      />
                    </label>
                    <label>
                      Max step size
                      <input
                        type="number"
                        value={branchContinuationDraft.maxStepSize}
                        onChange={(event) =>
                          setBranchContinuationDraft((prev) => ({
                            ...prev,
                            maxStepSize: event.target.value,
                          }))
                        }
                        data-testid="branch-from-point-max-step"
                      />
                    </label>
                    <label>
                      Corrector steps
                      <input
                        type="number"
                        value={branchContinuationDraft.correctorSteps}
                        onChange={(event) =>
                          setBranchContinuationDraft((prev) => ({
                            ...prev,
                            correctorSteps: event.target.value,
                          }))
                        }
                        data-testid="branch-from-point-corrector-steps"
                      />
                    </label>
                    <label>
                      Corrector tolerance
                      <input
                        type="number"
                        value={branchContinuationDraft.correctorTolerance}
                        onChange={(event) =>
                          setBranchContinuationDraft((prev) => ({
                            ...prev,
                            correctorTolerance: event.target.value,
                          }))
                        }
                        data-testid="branch-from-point-corrector-tolerance"
                      />
                    </label>
                    <label>
                      Step tolerance
                      <input
                        type="number"
                        value={branchContinuationDraft.stepTolerance}
                        onChange={(event) =>
                          setBranchContinuationDraft((prev) => ({
                            ...prev,
                            stepTolerance: event.target.value,
                          }))
                        }
                        data-testid="branch-from-point-step-tolerance"
                      />
                    </label>
                    {branchContinuationError ? (
                      <div className="field-error">{branchContinuationError}</div>
                    ) : null}
                    <button
                      onClick={handleCreateBranchFromPoint}
                      disabled={
                        runDisabled ||
                        !selectedBranchPoint ||
                        branch.branchType !== 'equilibrium'
                      }
                      data-testid="branch-from-point-submit"
                    >
                      Create Branch
                    </button>
                  </div>
                </InspectorDisclosure>

                <InspectorDisclosure
                  key={`${selectionKey}-codim1-curves`}
                  title="Codim-1 Curve Continuations"
                  testId="codim1-curve-toggle"
                  defaultOpen={false}
                >
                  <div className="inspector-section">
                    {branch.branchType !== 'equilibrium' ? (
                      <p className="empty-state">
                        Codim-1 curve continuation is only available for equilibrium branches.
                      </p>
                    ) : null}
                    {runDisabled ? (
                      <div className="field-warning">
                        Apply valid system changes before continuing.
                      </div>
                    ) : null}
                    {systemDraft.paramNames.length < 2 ? (
                      <p className="empty-state">
                        Add a second parameter to enable codim-1 continuation.
                      </p>
                    ) : null}
                    {!selectedBranchPoint ? (
                      <p className="empty-state">Select a branch point to continue.</p>
                    ) : selectedBranchPoint.stability === 'Fold' ? (
                      <>
                        <h4 className="inspector-subheading">Fold curve</h4>
                        <label>
                          Curve name
                          <input
                            value={foldCurveDraft.name}
                            onChange={(event) =>
                              setFoldCurveDraft((prev) => ({
                                ...prev,
                                name: event.target.value,
                              }))
                            }
                            placeholder={`fold_curve_${toCliSafeName(branch.name)}`}
                            data-testid="fold-curve-name"
                          />
                        </label>
                        <label>
                          Second parameter
                          <select
                            value={foldCurveDraft.param2Name}
                            onChange={(event) =>
                              setFoldCurveDraft((prev) => ({
                                ...prev,
                                param2Name: event.target.value,
                              }))
                            }
                            disabled={codim1ParamOptions.length === 0}
                            data-testid="fold-curve-param2"
                          >
                            {codim1ParamOptions.map((name) => {
                              const idx = systemDraft.paramNames.indexOf(name)
                              const branchValue =
                                branchParams.length === systemDraft.paramNames.length
                                  ? branchParams[idx]
                                  : undefined
                              const fallbackValue = parseNumber(systemDraft.params[idx] ?? '')
                              const value = branchValue ?? fallbackValue
                              const label = `${name} (current: ${formatNumber(
                                value ?? Number.NaN,
                                6
                              )})`
                              return (
                                <option key={name} value={name}>
                                  {label}
                                </option>
                              )
                            })}
                          </select>
                        </label>
                        <label>
                          Direction
                          <select
                            value={foldCurveDraft.forward ? 'forward' : 'backward'}
                            onChange={(event) =>
                              setFoldCurveDraft((prev) => ({
                                ...prev,
                                forward: event.target.value === 'forward',
                              }))
                            }
                            data-testid="fold-curve-direction"
                          >
                            <option value="forward">Forward</option>
                            <option value="backward">Backward</option>
                          </select>
                        </label>
                        <label>
                          Initial step size
                          <input
                            type="number"
                            value={foldCurveDraft.stepSize}
                            onChange={(event) =>
                              setFoldCurveDraft((prev) => ({
                                ...prev,
                                stepSize: event.target.value,
                              }))
                            }
                            data-testid="fold-curve-step-size"
                          />
                        </label>
                        <label>
                          Min step size
                          <input
                            type="number"
                            value={foldCurveDraft.minStepSize}
                            onChange={(event) =>
                              setFoldCurveDraft((prev) => ({
                                ...prev,
                                minStepSize: event.target.value,
                              }))
                            }
                            data-testid="fold-curve-min-step-size"
                          />
                        </label>
                        <label>
                          Max step size
                          <input
                            type="number"
                            value={foldCurveDraft.maxStepSize}
                            onChange={(event) =>
                              setFoldCurveDraft((prev) => ({
                                ...prev,
                                maxStepSize: event.target.value,
                              }))
                            }
                            data-testid="fold-curve-max-step-size"
                          />
                        </label>
                        <label>
                          Max points
                          <input
                            type="number"
                            value={foldCurveDraft.maxSteps}
                            onChange={(event) =>
                              setFoldCurveDraft((prev) => ({
                                ...prev,
                                maxSteps: event.target.value,
                              }))
                            }
                            data-testid="fold-curve-max-steps"
                          />
                        </label>
                        <label>
                          Corrector steps
                          <input
                            type="number"
                            value={foldCurveDraft.correctorSteps}
                            onChange={(event) =>
                              setFoldCurveDraft((prev) => ({
                                ...prev,
                                correctorSteps: event.target.value,
                              }))
                            }
                            data-testid="fold-curve-corrector-steps"
                          />
                        </label>
                        <label>
                          Corrector tolerance
                          <input
                            type="number"
                            value={foldCurveDraft.correctorTolerance}
                            onChange={(event) =>
                              setFoldCurveDraft((prev) => ({
                                ...prev,
                                correctorTolerance: event.target.value,
                              }))
                            }
                            data-testid="fold-curve-corrector-tolerance"
                          />
                        </label>
                        <label>
                          Step tolerance
                          <input
                            type="number"
                            value={foldCurveDraft.stepTolerance}
                            onChange={(event) =>
                              setFoldCurveDraft((prev) => ({
                                ...prev,
                                stepTolerance: event.target.value,
                              }))
                            }
                            data-testid="fold-curve-step-tolerance"
                          />
                        </label>
                        {foldCurveError ? (
                          <div className="field-error">{foldCurveError}</div>
                        ) : null}
                        <button
                          onClick={handleCreateFoldCurve}
                          disabled={
                            runDisabled ||
                            !selectedBranchPoint ||
                            branch.branchType !== 'equilibrium'
                          }
                          data-testid="fold-curve-submit"
                        >
                          Continue Fold Curve
                        </button>
                      </>
                    ) : selectedBranchPoint.stability === 'Hopf' ? (
                      <>
                        <h4 className="inspector-subheading">Hopf curve</h4>
                        <label>
                          Curve name
                          <input
                            value={hopfCurveDraft.name}
                            onChange={(event) =>
                              setHopfCurveDraft((prev) => ({
                                ...prev,
                                name: event.target.value,
                              }))
                            }
                            placeholder={`hopf_curve_${toCliSafeName(branch.name)}`}
                            data-testid="hopf-curve-name"
                          />
                        </label>
                        <label>
                          Second parameter
                          <select
                            value={hopfCurveDraft.param2Name}
                            onChange={(event) =>
                              setHopfCurveDraft((prev) => ({
                                ...prev,
                                param2Name: event.target.value,
                              }))
                            }
                            disabled={codim1ParamOptions.length === 0}
                            data-testid="hopf-curve-param2"
                          >
                            {codim1ParamOptions.map((name) => {
                              const idx = systemDraft.paramNames.indexOf(name)
                              const branchValue =
                                branchParams.length === systemDraft.paramNames.length
                                  ? branchParams[idx]
                                  : undefined
                              const fallbackValue = parseNumber(systemDraft.params[idx] ?? '')
                              const value = branchValue ?? fallbackValue
                              const label = `${name} (current: ${formatNumber(
                                value ?? Number.NaN,
                                6
                              )})`
                              return (
                                <option key={name} value={name}>
                                  {label}
                                </option>
                              )
                            })}
                          </select>
                        </label>
                        <label>
                          Hopf frequency (ω)
                          <input
                            value={formatNumber(hopfOmega ?? Number.NaN, 6)}
                            disabled
                            data-testid="hopf-curve-omega"
                          />
                        </label>
                        <label>
                          Direction
                          <select
                            value={hopfCurveDraft.forward ? 'forward' : 'backward'}
                            onChange={(event) =>
                              setHopfCurveDraft((prev) => ({
                                ...prev,
                                forward: event.target.value === 'forward',
                              }))
                            }
                            data-testid="hopf-curve-direction"
                          >
                            <option value="forward">Forward</option>
                            <option value="backward">Backward</option>
                          </select>
                        </label>
                        <label>
                          Initial step size
                          <input
                            type="number"
                            value={hopfCurveDraft.stepSize}
                            onChange={(event) =>
                              setHopfCurveDraft((prev) => ({
                                ...prev,
                                stepSize: event.target.value,
                              }))
                            }
                            data-testid="hopf-curve-step-size"
                          />
                        </label>
                        <label>
                          Min step size
                          <input
                            type="number"
                            value={hopfCurveDraft.minStepSize}
                            onChange={(event) =>
                              setHopfCurveDraft((prev) => ({
                                ...prev,
                                minStepSize: event.target.value,
                              }))
                            }
                            data-testid="hopf-curve-min-step-size"
                          />
                        </label>
                        <label>
                          Max step size
                          <input
                            type="number"
                            value={hopfCurveDraft.maxStepSize}
                            onChange={(event) =>
                              setHopfCurveDraft((prev) => ({
                                ...prev,
                                maxStepSize: event.target.value,
                              }))
                            }
                            data-testid="hopf-curve-max-step-size"
                          />
                        </label>
                        <label>
                          Max points
                          <input
                            type="number"
                            value={hopfCurveDraft.maxSteps}
                            onChange={(event) =>
                              setHopfCurveDraft((prev) => ({
                                ...prev,
                                maxSteps: event.target.value,
                              }))
                            }
                            data-testid="hopf-curve-max-steps"
                          />
                        </label>
                        <label>
                          Corrector steps
                          <input
                            type="number"
                            value={hopfCurveDraft.correctorSteps}
                            onChange={(event) =>
                              setHopfCurveDraft((prev) => ({
                                ...prev,
                                correctorSteps: event.target.value,
                              }))
                            }
                            data-testid="hopf-curve-corrector-steps"
                          />
                        </label>
                        <label>
                          Corrector tolerance
                          <input
                            type="number"
                            value={hopfCurveDraft.correctorTolerance}
                            onChange={(event) =>
                              setHopfCurveDraft((prev) => ({
                                ...prev,
                                correctorTolerance: event.target.value,
                              }))
                            }
                            data-testid="hopf-curve-corrector-tolerance"
                          />
                        </label>
                        <label>
                          Step tolerance
                          <input
                            type="number"
                            value={hopfCurveDraft.stepTolerance}
                            onChange={(event) =>
                              setHopfCurveDraft((prev) => ({
                                ...prev,
                                stepTolerance: event.target.value,
                              }))
                            }
                            data-testid="hopf-curve-step-tolerance"
                          />
                        </label>
                        {hopfCurveError ? (
                          <div className="field-error">{hopfCurveError}</div>
                        ) : null}
                        <button
                          onClick={handleCreateHopfCurve}
                          disabled={
                            runDisabled ||
                            !selectedBranchPoint ||
                            branch.branchType !== 'equilibrium'
                          }
                          data-testid="hopf-curve-submit"
                        >
                          Continue Hopf Curve
                        </button>
                      </>
                    ) : (
                      <p className="empty-state">
                        Select a Fold or Hopf point to continue a codim-1 curve.
                      </p>
                    )}
                  </div>
                </InspectorDisclosure>

                <InspectorDisclosure
                  key={`${selectionKey}-limit-cycle-hopf`}
                  title="Limit Cycle from Hopf"
                  testId="limit-cycle-from-hopf-toggle"
                  defaultOpen={false}
                >
                  <div className="inspector-section">
                    {!isHopfSourceBranch ? (
                      <p className="empty-state">
                        Limit cycle continuation is only available for equilibrium or Hopf curve
                        branches.
                      </p>
                    ) : null}
                    {systemDraft.type === 'map' ? (
                      <p className="empty-state">Limit cycles require a flow system.</p>
                    ) : null}
                    {systemDraft.paramNames.length === 0 ? (
                      <p className="empty-state">Add a parameter before continuing.</p>
                    ) : null}
                    {runDisabled ? (
                      <div className="field-warning">
                        Apply valid system changes before continuing.
                      </div>
                    ) : null}
                    {!isHopfSourceBranch ||
                    systemDraft.type === 'map' ||
                    systemDraft.paramNames.length === 0 ? null : !selectedBranchPoint ? (
                      <p className="empty-state">Select a branch point to continue.</p>
                    ) : !isHopfPointSelected ? (
                      <p className="empty-state">
                        Select a Hopf bifurcation point to continue a limit cycle.
                      </p>
                    ) : (
                      <>
                        <label>
                          Limit cycle name
                          <input
                            value={limitCycleFromHopfDraft.limitCycleName}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                limitCycleName: event.target.value,
                              }))
                            }
                            placeholder={`lc_hopf_${toCliSafeName(branch.name)}`}
                            data-testid="limit-cycle-from-hopf-name"
                          />
                        </label>
                        <label>
                          Branch name
                          <input
                            value={limitCycleFromHopfDraft.branchName}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                branchName: event.target.value,
                              }))
                            }
                            placeholder={limitCycleFromHopfBranchSuggestion}
                            data-testid="limit-cycle-from-hopf-branch-name"
                          />
                        </label>
                        <label>
                          Continuation parameter
                          <select
                            value={limitCycleFromHopfDraft.parameterName}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                parameterName: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-hopf-parameter"
                          >
                            {systemDraft.paramNames.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Initial amplitude
                          <input
                            type="number"
                            value={limitCycleFromHopfDraft.amplitude}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                amplitude: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-hopf-amplitude"
                          />
                        </label>
                        <label>
                          NTST
                          <input
                            type="number"
                            value={limitCycleFromHopfDraft.ntst}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                ntst: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-hopf-ntst"
                          />
                        </label>
                        <label>
                          NCOL
                          <input
                            type="number"
                            value={limitCycleFromHopfDraft.ncol}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                ncol: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-hopf-ncol"
                          />
                        </label>
                        <label>
                          Direction
                          <select
                            value={limitCycleFromHopfDraft.forward ? 'forward' : 'backward'}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                forward: event.target.value === 'forward',
                              }))
                            }
                            data-testid="limit-cycle-from-hopf-direction"
                          >
                            <option value="forward">Forward (Increasing Param)</option>
                            <option value="backward">Backward (Decreasing Param)</option>
                          </select>
                        </label>
                        <label>
                          Initial step size
                          <input
                            type="number"
                            value={limitCycleFromHopfDraft.stepSize}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                stepSize: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-hopf-step-size"
                          />
                        </label>
                        <label>
                          Max points
                          <input
                            type="number"
                            value={limitCycleFromHopfDraft.maxSteps}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                maxSteps: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-hopf-max-steps"
                          />
                        </label>
                        <label>
                          Min step size
                          <input
                            type="number"
                            value={limitCycleFromHopfDraft.minStepSize}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                minStepSize: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-hopf-min-step-size"
                          />
                        </label>
                        <label>
                          Max step size
                          <input
                            type="number"
                            value={limitCycleFromHopfDraft.maxStepSize}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                maxStepSize: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-hopf-max-step-size"
                          />
                        </label>
                        <label>
                          Corrector steps
                          <input
                            type="number"
                            value={limitCycleFromHopfDraft.correctorSteps}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                correctorSteps: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-hopf-corrector-steps"
                          />
                        </label>
                        <label>
                          Corrector tolerance
                          <input
                            type="number"
                            value={limitCycleFromHopfDraft.correctorTolerance}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                correctorTolerance: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-hopf-corrector-tolerance"
                          />
                        </label>
                        <label>
                          Step tolerance
                          <input
                            type="number"
                            value={limitCycleFromHopfDraft.stepTolerance}
                            onChange={(event) =>
                              setLimitCycleFromHopfDraft((prev) => ({
                                ...prev,
                                stepTolerance: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-hopf-step-tolerance"
                          />
                        </label>
                        {limitCycleFromHopfError ? (
                          <div className="field-error">{limitCycleFromHopfError}</div>
                        ) : null}
                        <button
                          onClick={handleCreateLimitCycleFromHopf}
                          disabled={
                            runDisabled ||
                            !selectedBranchPoint ||
                            !isHopfSourceBranch ||
                            !isHopfPointSelected ||
                            systemDraft.paramNames.length === 0
                          }
                          data-testid="limit-cycle-from-hopf-submit"
                        >
                          Continue Limit Cycle
                        </button>
                      </>
                    )}
                  </div>
                </InspectorDisclosure>

                <InspectorDisclosure
                  key={`${selectionKey}-limit-cycle-pd`}
                  title="Limit Cycle from PD"
                  testId="limit-cycle-from-pd-toggle"
                  defaultOpen={false}
                >
                  <div className="inspector-section">
                    {branch.branchType !== 'limit_cycle' ? (
                      <p className="empty-state">
                        Period-doubling branching is only available for limit cycle branches.
                      </p>
                    ) : null}
                    {systemDraft.type === 'map' ? (
                      <p className="empty-state">Limit cycles require a flow system.</p>
                    ) : null}
                    {runDisabled ? (
                      <div className="field-warning">
                        Apply valid system changes before continuing.
                      </div>
                    ) : null}
                    {!selectedBranchPoint ? (
                      <p className="empty-state">Select a branch point to continue.</p>
                    ) : selectedBranchPoint.stability !== 'PeriodDoubling' ? (
                      <p className="empty-state">
                        Select a Period Doubling point to branch.
                      </p>
                    ) : (
                      <>
                        <label>
                          Limit cycle name
                          <input
                            value={limitCycleFromPDDraft.limitCycleName}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                limitCycleName: event.target.value,
                              }))
                            }
                            placeholder={limitCycleFromPDNameSuggestion}
                            data-testid="limit-cycle-from-pd-name"
                          />
                        </label>
                        <label>
                          Branch name
                          <input
                            value={limitCycleFromPDDraft.branchName}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                branchName: event.target.value,
                              }))
                            }
                            placeholder={limitCycleFromPDBranchSuggestion}
                            data-testid="limit-cycle-from-pd-branch-name"
                          />
                        </label>
                        <label>
                          Continuation parameter
                          <input
                            value={branchParameterName}
                            disabled
                            data-testid="limit-cycle-from-pd-parameter"
                          />
                        </label>
                        <label>
                          Perturbation amplitude
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.amplitude}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                amplitude: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-amplitude"
                          />
                        </label>
                        <label>
                          NTST (doubled)
                          <input
                            value={(limitCycleMesh.ntst * 2).toString()}
                            disabled
                            data-testid="limit-cycle-from-pd-ntst"
                          />
                        </label>
                        <label>
                          NCOL
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.ncol}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                ncol: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-ncol"
                          />
                        </label>
                        <label>
                          Direction
                          <select
                            value={limitCycleFromPDDraft.forward ? 'forward' : 'backward'}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                forward: event.target.value === 'forward',
                              }))
                            }
                            data-testid="limit-cycle-from-pd-direction"
                          >
                            <option value="forward">Forward (Increasing Param)</option>
                            <option value="backward">Backward (Decreasing Param)</option>
                          </select>
                        </label>
                        <label>
                          Initial step size
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.stepSize}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                stepSize: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-step-size"
                          />
                        </label>
                        <label>
                          Max points
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.maxSteps}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                maxSteps: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-max-steps"
                          />
                        </label>
                        <label>
                          Min step size
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.minStepSize}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                minStepSize: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-min-step-size"
                          />
                        </label>
                        <label>
                          Max step size
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.maxStepSize}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                maxStepSize: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-max-step-size"
                          />
                        </label>
                        <label>
                          Corrector steps
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.correctorSteps}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                correctorSteps: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-corrector-steps"
                          />
                        </label>
                        <label>
                          Corrector tolerance
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.correctorTolerance}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                correctorTolerance: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-corrector-tolerance"
                          />
                        </label>
                        <label>
                          Step tolerance
                          <input
                            type="number"
                            value={limitCycleFromPDDraft.stepTolerance}
                            onChange={(event) =>
                              setLimitCycleFromPDDraft((prev) => ({
                                ...prev,
                                stepTolerance: event.target.value,
                              }))
                            }
                            data-testid="limit-cycle-from-pd-step-tolerance"
                          />
                        </label>
                        {limitCycleFromPDError ? (
                          <div className="field-error">{limitCycleFromPDError}</div>
                        ) : null}
                        <button
                          onClick={handleCreateLimitCycleFromPD}
                          disabled={
                            runDisabled ||
                            branch.branchType !== 'limit_cycle' ||
                            selectedBranchPoint?.stability !== 'PeriodDoubling'
                          }
                          data-testid="limit-cycle-from-pd-submit"
                        >
                          Continue Limit Cycle
                        </button>
                      </>
                    )}
                  </div>
                </InspectorDisclosure>
              </>
            ) : null}
          </div>
        ) : (
          <p className="empty-state">Select a node to inspect details.</p>
        )}
      </div>
    )
  }

  if (view === 'system') return renderSystemView()
  return renderSelectionView()
}
