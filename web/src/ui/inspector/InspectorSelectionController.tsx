import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Data, Layout } from 'plotly.js'
import type {
  AnalysisViewport,
  BifurcationAxis,
  BifurcationDiagram,
  ClvRenderStyle,
  ComplexValue,
  FloquetBackend,
  ContinuationObject,
  ContinuationPoint,
  EquilibriumEigenvectorRenderStyle,
  EquilibriumObject,
  IsoclineObject,
  LimitCycleObject,
  LimitCycleOrigin,
  LimitCycleRenderTarget,
  ManifoldCycle2DAlgorithm,
  ManifoldDirection,
  ManifoldStability,
  ManifoldTerminationCaps,
  OrbitObject,
  Scene,
  System,
  SystemConfig,
  TreeNode,
} from '../../system/types'
import { DEFAULT_RENDER, DEFAULT_SCENE_CAMERA } from '../../system/model'
import { defaultClvIndices, resolveClvColors, resolveClvRender } from '../../system/clv'
import {
  defaultEquilibriumEigenvectorIndices,
  isRealEigenvalue,
  resolveEquilibriumEigenvalueMarkerColors,
  resolveEquilibriumEigenvectorColors,
  resolveEquilibriumEigenspaceIndices,
  resolveEquilibriumEigenvectorRender,
} from '../../system/equilibriumEigenvectors'
import { maxSceneAxisCount, resolveSceneAxisSelection } from '../../system/sceneAxes'
import { formatEquilibriumLabel } from '../../system/labels'
import { PlotlyViewport } from '../../viewports/plotly/PlotlyViewport'
import { resolvePlotlyThemeTokens, type PlotlyThemeTokens } from '../../viewports/plotly/plotlyTheme'
import type {
  BranchContinuationRequest,
  BranchExtensionRequest,
  Codim2BranchCreationRequest,
  EquilibriumManifold1DExtensionRequest,
  Manifold2DExtensionRequest,
  EquilibriumManifold1DRequest,
  EquilibriumManifold2DRequest,
  EquilibriumContinuationRequest,
  EquilibriumSolveRequest,
  FoldCurveContinuationRequest,
  HomoclinicFromHomoclinicRequest,
  HomoclinicFromHomotopySaddleRequest,
  HomoclinicFromLargeCycleRequest,
  HopfCurveContinuationRequest,
  HomotopySaddleFromEquilibriumRequest,
  IsoperiodicCurveContinuationRequest,
  IsoclineComputeRequest,
  LimitCycleFloquetModesRequest,
  LimitCycleCodim1CurveCreationRequest,
  MapNSCurveContinuationRequest,
  LimitCycleManifold2DRequest,
  LimitCycleHopfContinuationRequest,
  OrbitCovariantLyapunovRequest,
  OrbitLyapunovRequest,
  OrbitRunRequest,
  LimitCycleOrbitContinuationRequest,
  LimitCyclePDContinuationRequest,
  MapCyclePDContinuationRequest,
  NormalFormAtPointRequest,
  PeriodicBranchPointCreationRequest,
} from '../../state/appState'
import type {
  BranchPointSelection,
  LimitCyclePointSelection,
  OrbitPointSelection,
} from '../branchPointSelection'
import { validateSystemConfig } from '../../state/systemValidation'
import { hasCustomObjectParams } from '../../system/parameters'
import {
  makeSurfaceProfileDefaults,
  toManifold2DProfile,
  type EquilibriumManifoldProfileDraft,
} from '../manifoldProfileDrafts'
import {
  buildSortedArrayOrder,
  computeLimitCycleMetrics,
  extractHopfOmega,
  extractLimitCycleProfile,
  ensureBranchIndices,
  getBranchParams,
  interpretLimitCycleStability,
  normalizeEigenvalueArray,
  resolveContinuationPointEquilibriumState,
  resolveContinuationPointParam2Value,
} from '../../system/continuation'
import { isCliSafeName, suggestDefaultName } from '../../utils/naming'
import {
  buildSubsystemSnapshot,
  continuationParameterOptions,
  formatParameterRefLabel,
  isSubsystemSnapshotCompatible,
  isVariableFrozen,
  mapStateRowsToDisplay,
  stateVectorToDisplay,
} from '../../system/subsystemGateway'
import {
  cycleManifoldFloquetEligibility,
  normalizeFloquetMultipliersForRendering,
} from '../../system/floquetModes'
import { AnalysisViewportInspector } from '../AnalysisViewportInspector'
import { BranchNavigatorContent } from '../BranchNavigator'
import {
  resolveBranchPointParams,
  resolveCodim1ParamNames,
  resolveContinuationParameterReadout,
} from '../branchPointDisplay'
import {
  DEFAULT_VARIABLE_PERIOD,
  normalizePeriodicVariables,
  parsePeriodExpression,
} from '../../system/periodicity'
import { SystemEditorPanel } from './SystemEditorPanel'
import {
  WorkflowActionList,
  WorkflowFocusProvider,
  WorkflowFocusToolbar,
} from './selectionSession'
import { isWorkflowId, type WorkflowActionEntry } from './selectionSessionState'
import { useWorkflowFocus } from './useWorkflowFocus'
import {
  buildCollocationAdaptivitySettings,
  type CollocationAdaptivityDraft,
} from './collocationAdaptivity'
import { supportsNormalFormWorkflow } from './sections/branch/normalFormPresentation'

import { SelectionInspectorView } from './SelectionInspectorView'

type InspectorDetailsPanelProps = {
  system: System
  selectedNodeId: string | null
  view: 'selection' | 'system'
  theme: 'light' | 'dark'
  branchPointSelection?: BranchPointSelection
  orbitPointSelection?: OrbitPointSelection
  limitCyclePointSelection?: LimitCyclePointSelection
  onBranchPointSelect?: (selection: BranchPointSelection) => void
  onOrbitPointSelect?: (selection: OrbitPointSelection) => void
  onLimitCyclePointSelect?: (selection: LimitCyclePointSelection) => void
  onRename: (id: string, name: string) => void
  onToggleVisibility: (id: string) => void
  onUpdateRender: (id: string, render: Partial<TreeNode['render']>) => void
  onUpdateObjectParams?: (id: string, params: number[] | null) => void
  onUpdateObjectFrozenVariables?: (
    id: string,
    frozenValuesByVarName: Record<string, number>
  ) => void
  onUpdateIsoclineObject?: (
    id: string,
    update: Partial<Omit<IsoclineObject, 'type' | 'name' | 'systemName'>>
  ) => void
  onComputeIsocline?: (
    request: IsoclineComputeRequest,
    opts?: { signal?: AbortSignal; silent?: boolean }
  ) => Promise<unknown>
  onUpdateScene: (id: string, update: Partial<Omit<Scene, 'id' | 'name'>>) => void
  onUpdateAnalysisViewport?: (
    id: string,
    update: Partial<Omit<AnalysisViewport, 'id' | 'name'>>
  ) => void
  onValidateAnalysisExpression?: (
    request: {
      system: SystemConfig
      expression: string
      role: 'event' | 'observable'
    },
    opts?: { signal?: AbortSignal }
  ) => Promise<void>
  onUpdateBifurcationDiagram: (
    id: string,
    update: Partial<Omit<BifurcationDiagram, 'id' | 'name'>>
  ) => void
  onSetLimitCycleRenderTarget?: (
    objectId: string,
    target: LimitCycleRenderTarget | null
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
  onCreateEquilibriumBranch: (request: EquilibriumContinuationRequest) => Promise<void>
  onCreateEquilibriumManifold1D?: (
    request: EquilibriumManifold1DRequest
  ) => Promise<void>
  onExtendEquilibriumManifold1D?: (
    request: EquilibriumManifold1DExtensionRequest
  ) => Promise<void>
  onExtendManifold2D?: (request: Manifold2DExtensionRequest) => Promise<void>
  onCreateEquilibriumManifold2D?: (
    request: EquilibriumManifold2DRequest
  ) => Promise<void>
  onCreateBranchFromPoint: (request: BranchContinuationRequest) => Promise<void>
  onExtendBranch: (request: BranchExtensionRequest) => Promise<void>
  onCreateFoldCurveFromPoint: (request: FoldCurveContinuationRequest) => Promise<void>
  onCreateHopfCurveFromPoint: (request: HopfCurveContinuationRequest) => Promise<void>
  onComputeNormalFormAtPoint?: (request: NormalFormAtPointRequest) => Promise<void>
  onCreateCodim2BranchFromPoint?: (request: Codim2BranchCreationRequest) => Promise<void>
  onCreatePeriodicBranchFromPoint?: (
    request: PeriodicBranchPointCreationRequest
  ) => Promise<void>
  onCreateIsoperiodicCurveFromPoint?: (
    request: IsoperiodicCurveContinuationRequest
  ) => Promise<void>
  onCreateLimitCycleCodim1CurveFromPoint?: (
    request: LimitCycleCodim1CurveCreationRequest
  ) => Promise<void>
  onCreateNSCurveFromPoint: (request: MapNSCurveContinuationRequest) => Promise<void>
  onCreateLimitCycleFromHopf: (request: LimitCycleHopfContinuationRequest) => Promise<void>
  onCreateLimitCycleFromOrbit: (request: LimitCycleOrbitContinuationRequest) => Promise<void>
  onCreateLimitCycleManifold2D?: (
    request: LimitCycleManifold2DRequest
  ) => Promise<void>
  onComputeLimitCycleFloquetModes?: (
    request: LimitCycleFloquetModesRequest
  ) => Promise<void>
  onCreateCycleFromPD: (request: MapCyclePDContinuationRequest) => Promise<void>
  onCreateLimitCycleFromPD: (request: LimitCyclePDContinuationRequest) => Promise<void>
  onCreateHomoclinicFromLargeCycle?: (
    request: HomoclinicFromLargeCycleRequest
  ) => Promise<void>
  onCreateHomoclinicFromHomoclinic?: (
    request: HomoclinicFromHomoclinicRequest
  ) => Promise<void>
  onCreateHomotopySaddleFromEquilibrium?: (
    request: HomotopySaddleFromEquilibriumRequest
  ) => Promise<void>
  onCreateHomoclinicFromHomotopySaddle?: (
    request: HomoclinicFromHomotopySaddleRequest
  ) => Promise<void>
}

const STATE_SPACE_STRIDE_BRANCH_TYPES: ReadonlySet<ContinuationObject['branchType']> = new Set([
  'limit_cycle',
  'isoperiodic_curve',
  'homoclinic_curve',
  'homotopy_saddle_curve',
  'pd_curve',
  'lpc_curve',
  'ns_curve',
])

const MANIFOLD_SURFACE_BRANCH_TYPES: ReadonlySet<ContinuationObject['branchType']> = new Set([
  'eq_manifold_2d',
  'cycle_manifold_2d',
])

type SystemDraft = {
  name: string
  type: 'flow' | 'map'
  solver: string
  varNames: string[]
  paramNames: string[]
  params: string[]
  equations: string[]
  periodicVariables: Array<{ enabled: boolean; period: string }>
}

type OrbitRunDraft = {
  initialState: string[]
  duration: string
  dt: string
}

type SceneSelectableEntry = {
  id: string
  name: string
  type: string
  visible: boolean
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
  mapIterations: string
}

type LimitCycleFromOrbitDraft = CollocationAdaptivityDraft & {
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

type LimitCycleFromHopfDraft = CollocationAdaptivityDraft & {
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

type LimitCycleFromPDDraft = CollocationAdaptivityDraft & {
  limitCycleName: string
  branchName: string
  amplitude: string
  stepSize: string
  maxSteps: string
  minStepSize: string
  maxStepSize: string
  correctorSteps: string
  correctorTolerance: string
  stepTolerance: string
  forward: boolean
}

type HomoclinicFromLargeCycleDraft = {
  name: string
  parameterName: string
  param2Name: string
  targetNtst: string
  targetNcol: string
  freeTime: boolean
  freeEps0: boolean
  freeEps1: boolean
  stepSize: string
  maxSteps: string
  minStepSize: string
  maxStepSize: string
  correctorSteps: string
  correctorTolerance: string
  stepTolerance: string
  forward: boolean
}

type HomoclinicRestartDraft = {
  name: string
  parameterName: string
  param2Name: string
  targetNtst: string
  targetNcol: string
  freeTime: boolean
  freeEps0: boolean
  freeEps1: boolean
  stepSize: string
  maxSteps: string
  minStepSize: string
  maxStepSize: string
  correctorSteps: string
  correctorTolerance: string
  stepTolerance: string
  forward: boolean
}

type HomotopySaddleFromEquilibriumDraft = {
  name: string
  parameterName: string
  param2Name: string
  ntst: string
  ncol: string
  eps0: string
  eps1: string
  time: string
  eps1Tol: string
  stepSize: string
  maxSteps: string
  minStepSize: string
  maxStepSize: string
  correctorSteps: string
  correctorTolerance: string
  stepTolerance: string
  forward: boolean
}

type ManifoldCapsDraft = {
  maxSteps: string
  maxPoints: string
  maxRings: string
  maxVertices: string
  maxTime: string
  maxIterations: string
}

type EquilibriumManifoldMode = 'curve_1d' | 'surface_2d'

type EquilibriumManifoldDraft = {
  name: string
  mode: EquilibriumManifoldMode
  profile: EquilibriumManifoldProfileDraft
  stability: ManifoldStability
  direction: ManifoldDirection
  eigIndex: string
  eigIndexA: string
  eigIndexB: string
  eps: string
  initialRadius: string
  targetRadius: string
  leafDelta: string
  deltaMin: string
  ringPoints: string
  minSpacing: string
  maxSpacing: string
  alphaMin: string
  alphaMax: string
  deltaAlphaMin: string
  deltaAlphaMax: string
  integrationDt: string
  targetArclength: string
  caps: ManifoldCapsDraft
}

type EquilibriumManifoldExtensionDraft = {
  targetArclength: string
  integrationDt: string
  caps: ManifoldCapsDraft
}

type LimitCycleManifoldDraft = {
  name: string
  stability: ManifoldStability
  direction: ManifoldDirection
  algorithm: ManifoldCycle2DAlgorithm
  profile: EquilibriumManifoldProfileDraft
  floquetIndex: string
  initialRadius: string
  leafDelta: string
  deltaMin: string
  ringPoints: string
  minSpacing: string
  maxSpacing: string
  alphaMin: string
  alphaMax: string
  deltaAlphaMin: string
  deltaAlphaMax: string
  integrationDt: string
  targetArclength: string
  ntst: string
  ncol: string
  caps: ManifoldCapsDraft
}

type ContinuationDraft = CollocationAdaptivityDraft & {
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

type Codim1CurveDraft = CollocationAdaptivityDraft & {
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

type LimitCycleCodim1CurveTarget = LimitCycleCodim1CurveCreationRequest['curveType']

type LimitCycleCodim1CurveOption = {
  type: LimitCycleCodim1CurveTarget
  label: 'LPC' | 'PD' | 'NS'
  targetAuxiliary?: number
}

function limitCycleCodim1CurveOption(
  type: LimitCycleCodim1CurveTarget,
  targetAuxiliary?: number
): LimitCycleCodim1CurveOption {
  return {
    type,
    label:
      type === 'LimitPointCycle'
        ? 'LPC'
        : type === 'PeriodDoubling'
          ? 'PD'
          : 'NS',
    ...(Number.isFinite(targetAuxiliary) ? { targetAuxiliary } : {}),
  }
}

function limitCycleCodim1CurveOptionsForPoint(
  point: ContinuationPoint | null
): LimitCycleCodim1CurveOption[] {
  if (!point) return []
  const direct =
    point.stability === 'CycleFold'
      ? limitCycleCodim1CurveOption('LimitPointCycle')
      : point.stability === 'PeriodDoubling'
        ? limitCycleCodim1CurveOption('PeriodDoubling')
        : point.stability === 'NeimarkSacker'
          ? limitCycleCodim1CurveOption('NeimarkSacker')
          : null
  const options = new Map<LimitCycleCodim1CurveTarget, LimitCycleCodim1CurveOption>()
  if (direct) options.set(direct.type, direct)
  if (point.codim2?.refined && !point.codim2.candidate) {
    for (const branchSwitch of point.codim2.branch_switches ?? []) {
      if (
        !branchSwitch.available ||
        (branchSwitch.target !== 'LimitPointCycle' &&
          branchSwitch.target !== 'PeriodDoubling' &&
          branchSwitch.target !== 'NeimarkSacker')
      ) {
        continue
      }
      options.set(
        branchSwitch.target,
        limitCycleCodim1CurveOption(
          branchSwitch.target,
          branchSwitch.target_auxiliary
        )
      )
    }
  }
  return [...options.values()]
}

type IsoperiodicCurveDraft = CollocationAdaptivityDraft & {
  name: string
  parameterName: string
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

type IsoclineAxisDraft = {
  min: string
  max: string
  samples: string
}

const FLOW_SOLVERS = ['rk4', 'tsit5']
const ORBIT_PREVIEW_PAGE_SIZE = 10

function adjustArray<T>(values: T[], targetLength: number, fill: () => T): T[] {
  if (values.length === targetLength) return values
  if (values.length > targetLength) return values.slice(0, targetLength)
  return [...values, ...Array.from({ length: targetLength - values.length }, fill)]
}

const POINT_NUMBER_REGEX = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

function parsePointValues(text: string): number[] {
  const matches = text.match(POINT_NUMBER_REGEX)
  if (!matches) return []
  return matches
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
}

function formatPointValues(values: Array<number | string | null | undefined>): string {
  const formatted = values.map((value) => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value.toString() : 'NaN'
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : 'NaN'
    }
    return 'NaN'
  })
  return `[${formatted.join(', ')}]`
}

async function writeClipboardText(value: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    return
  }
}

async function readClipboardText(): Promise<string | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return null
  try {
    return await navigator.clipboard.readText()
  } catch {
    return null
  }
}

function applyPointValues(
  prev: string[],
  targetLength: number,
  values: number[]
): string[] {
  const next = adjustArray(prev, targetLength, () => '0')
  if (values.length === 0) return next
  const trimmed =
    values.length >= targetLength ? values.slice(values.length - targetLength) : values
  trimmed.forEach((value, index) => {
    if (Number.isFinite(value)) {
      next[index] = value.toString()
    }
  })
  return next
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

type StateTableProps = {
  title: string
  varNames: string[]
  values: string[]
  onChange: (next: string[]) => void
  onCopy: () => void
  onPaste: () => void
  emptyMessage?: string
  testIdPrefix?: string
}

function StateTable({
  title,
  varNames,
  values,
  onChange,
  onCopy,
  onPaste,
  emptyMessage,
  testIdPrefix,
}: StateTableProps) {
  const resolvedValues = adjustArray(values, varNames.length, () => '0')
  const hasVars = varNames.length > 0
  return (
    <div className="state-table">
      <div className="state-table__header">
        <span className="state-table__title">{title}</span>
        <div className="state-table__actions">
          <button
            type="button"
            className="inspector-inline-button"
            onClick={onCopy}
            disabled={!hasVars}
          >
            Copy
          </button>
          <button
            type="button"
            className="inspector-inline-button"
            onClick={onPaste}
            disabled={!hasVars}
          >
            Paste
          </button>
        </div>
      </div>
      {hasVars ? (
        <div className="state-table__wrap" role="region" aria-label={title}>
          <table className="state-table__grid">
            <thead>
              <tr>
                {varNames.map((name, index) => (
                  <th key={`state-head-${index}`}>{name || `x${index + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {resolvedValues.map((value, index) => (
                  <td key={`state-cell-${index}`}>
                    <input
                      type="number"
                      step="any"
                      className="state-table__input"
                      value={value ?? ''}
                      onChange={(event) => {
                        const next = [...resolvedValues]
                        next[index] = event.target.value
                        onChange(next)
                      }}
                      data-testid={testIdPrefix ? `${testIdPrefix}-${index}` : undefined}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">
          {emptyMessage ?? 'No state variables defined yet.'}
        </p>
      )}
    </div>
  )
}

function InspectorDisclosure({
  title,
  defaultOpen = false,
  open,
  onOpenChange,
  children,
  testId,
  actionOnly = false,
}: {
  title: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (nextOpen: boolean) => void
  children: ReactNode
  testId?: string
  actionOnly?: boolean
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const workflowFocus = useWorkflowFocus()
  const workflowId = isWorkflowId(testId) ? testId : null
  const workflowFocused = Boolean(
    workflowId && workflowFocus?.activeWorkflow === workflowId
  )
  const resolvedOpen = workflowFocus?.activeWorkflow
    ? workflowFocused
    : typeof open === 'boolean'
      ? open
      : uncontrolledOpen

  return (
    <details
      className={`inspector-disclosure${actionOnly ? ' inspector-disclosure--action-only' : ''}`}
      open={resolvedOpen}
      data-workflow-id={workflowId ?? undefined}
      data-workflow-active={workflowFocused ? 'true' : undefined}
      onToggle={(event) => {
        const nextOpen = (event.currentTarget as HTMLDetailsElement).open
        if (workflowFocus?.activeWorkflow) return
        if (typeof open !== 'boolean') {
          setUncontrolledOpen(nextOpen)
        }
        onOpenChange?.(nextOpen)
      }}
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

function formatBranchType(
  branch: ContinuationObject,
  systemType: SystemConfig['type']
): string {
  if (branch.branchType === 'equilibrium') {
    return formatEquilibriumLabel(systemType)
  }
  if (branch.branchType === 'eq_manifold_1d') return 'equilibrium manifold (1D)'
  if (branch.branchType === 'eq_manifold_2d') return 'equilibrium manifold (2D)'
  if (branch.branchType === 'cycle_manifold_2d') return 'cycle manifold (2D)'
  if (branch.branchType === 'hopf_curve' && systemType === 'map') {
    return 'neimark-sacker curve'
  }
  return branch.branchType.replaceAll('_', ' ')
}

function resolveManifoldSurfaceGeometryForInspector(
  geometry: ContinuationObject['data']['manifold_geometry'] | undefined
) {
  if (!geometry || geometry.type !== 'Surface') return null
  if ('Surface' in geometry && geometry.Surface) return geometry.Surface
  if ('vertices_flat' in geometry && Array.isArray(geometry.vertices_flat)) {
    return {
      dim: geometry.dim,
      vertices_flat: geometry.vertices_flat,
      triangles: geometry.triangles,
      ring_offsets: geometry.ring_offsets,
      ring_diagnostics: geometry.ring_diagnostics,
      solver_diagnostics: geometry.solver_diagnostics,
      resume_state: geometry.resume_state,
    }
  }
  return null
}

function resolveManifoldCurveGeometryForInspector(
  geometry: ContinuationObject['data']['manifold_geometry'] | undefined
) {
  if (!geometry || geometry.type !== 'Curve') return null
  if ('Curve' in geometry && geometry.Curve) return geometry.Curve
  if ('points_flat' in geometry && Array.isArray(geometry.points_flat)) {
    return {
      dim: geometry.dim,
      points_flat: geometry.points_flat,
      arclength: geometry.arclength,
      source_arclength: geometry.source_arclength,
      direction: geometry.direction,
      solver_diagnostics: geometry.solver_diagnostics,
      resume_state: geometry.resume_state,
    }
  }
  return null
}

function formatTerminationReasonLabel(reason: string | undefined): string {
  if (!reason || reason.trim().length === 0) return 'unknown'
  return reason
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function buildEigenvaluePlot(
  eigenvalues: ComplexValue[] | null | undefined,
  plotlyTheme: PlotlyThemeTokens,
  options?: {
    showRadiusLines?: boolean
    showUnitCircle?: boolean
    showUnitDisc?: boolean
    markerColors?: string[]
  }
) {
  if (!eigenvalues || eigenvalues.length === 0) return null
  const { background, text, muted } = plotlyTheme
  const showUnitCircle = options?.showUnitCircle ?? false
  const showUnitDisc = options?.showUnitDisc ?? false
  const x = eigenvalues.map((value) => value.re)
  const y = eigenvalues.map((value) => value.im)
  const finiteX = x.filter((value) => Number.isFinite(value))
  const finiteY = y.filter((value) => Number.isFinite(value))
  const safeX = finiteX.length > 0 ? finiteX : [0]
  const safeY = finiteY.length > 0 ? finiteY : [0]
  const showUnitOverlay = showUnitCircle || showUnitDisc
  const minX = showUnitOverlay ? Math.min(...safeX, -1, 0) : Math.min(...safeX, 0)
  const maxX = showUnitOverlay ? Math.max(...safeX, 1, 0) : Math.max(...safeX, 0)
  const minY = showUnitOverlay ? Math.min(...safeY, -1, 0) : Math.min(...safeY, 0)
  const maxY = showUnitOverlay ? Math.max(...safeY, 1, 0) : Math.max(...safeY, 0)
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
  const unitCircle: Data[] = showUnitCircle && !showUnitDisc
    ? [
        {
          x: Array.from({ length: 129 }, (_, idx) => Math.cos((idx / 128) * 2 * Math.PI)),
          y: Array.from({ length: 129 }, (_, idx) => Math.sin((idx / 128) * 2 * Math.PI)),
          mode: 'lines',
          type: 'scatter',
          line: { color: 'rgba(120,120,120,0.45)', width: 1 },
          hoverinfo: 'skip',
          showlegend: false,
        },
      ]
    : []
  const markerColor =
    options?.markerColors && options.markerColors.length === eigenvalues.length
      ? options.markerColors
      : 'var(--accent)'
  const data: Data[] = [
    ...unitCircle,
    ...radiusLines,
    {
      x,
      y,
      mode: 'markers',
      type: 'scatter',
      name: 'Eigenvalues',
      marker: {
        color: markerColor,
        size: 8,
        line: { color: 'var(--panel-border)', width: 1 },
      },
      hovertemplate: 'Re %{x:.4f}<br>Im %{y:.4f}<extra></extra>',
    },
  ]
  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 36, r: 16, t: 8, b: 32 },
    paper_bgcolor: background,
    plot_bgcolor: background,
    showlegend: false,
    dragmode: 'pan',
    font: { color: text },
    xaxis: {
      title: { text: 'Real part', font: { size: 11, color: text } },
      zerolinecolor: 'rgba(120,120,120,0.3)',
      gridcolor: 'rgba(120,120,120,0.15)',
      tickfont: { size: 10, color: muted },
      range: rangeX,
    },
    yaxis: {
      title: { text: 'Imaginary part', font: { size: 11, color: text } },
      zerolinecolor: 'rgba(120,120,120,0.3)',
      gridcolor: 'rgba(120,120,120,0.15)',
      tickfont: { size: 10, color: muted },
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
        font: { size: 10, color: muted },
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
        font: { size: 10, color: muted },
      },
    ],
  }
  if (showUnitDisc) {
    layout.shapes = [
      {
        type: 'circle',
        xref: 'x',
        yref: 'y',
        x0: -1,
        y0: -1,
        x1: 1,
        y1: 1,
        fillcolor: 'rgba(120,120,120,0.12)',
        line: { color: 'rgba(120,120,120,0.45)', width: 1 },
        layer: 'below',
      },
    ]
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
  const defaultMapIterations =
    system.type === 'map'
      ? equilibrium?.lastSolverParams?.mapIterations ?? 1
      : 1
  return {
    initialGuess: adjustArray(
      defaultGuess.map((value) => value.toString()),
      system.varNames.length,
      () => '0'
    ),
    maxSteps: defaultMaxSteps.toString(),
    dampingFactor: defaultDamping.toString(),
    mapIterations: defaultMapIterations.toString(),
  }
}

function makeParamOverrideDraft(
  system: SystemConfig,
  object?: OrbitObject | EquilibriumObject | LimitCycleObject | IsoclineObject | null
): string[] {
  const fallback = system.params.map((value) => value.toString())
  const customParams =
    object?.customParameters && object.customParameters.length === system.params.length
      ? object.customParameters.map((value) => value.toString())
      : fallback
  return adjustArray(customParams, system.paramNames.length, () => '0')
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
    maxSteps: '300',
    minStepSize: '1e-5',
    maxStepSize: '0.1',
    correctorSteps: '10',
    correctorTolerance: '1e-6',
    stepTolerance: '1e-6',
    adaptiveCollocationEnabled: true,
    adaptiveRedistributionEnabled: true,
    adaptiveDefectTolerance: '0.025',
    adaptiveMaxRefinements: '3',
    adaptiveMaxMeshPoints: '512',
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
    maxSteps: '300',
    minStepSize: '1e-5',
    maxStepSize: '0.1',
    correctorSteps: '10',
    correctorTolerance: '1e-6',
    stepTolerance: '1e-6',
    adaptiveCollocationEnabled: true,
    adaptiveRedistributionEnabled: true,
    adaptiveDefectTolerance: '0.025',
    adaptiveMaxRefinements: '3',
    adaptiveMaxMeshPoints: '512',
    forward: true,
  }
}

function makeLimitCycleFromPDDraft(): LimitCycleFromPDDraft {
  return {
    limitCycleName: '',
    branchName: '',
    amplitude: '0.01',
    stepSize: '0.01',
    maxSteps: '300',
    minStepSize: '1e-5',
    maxStepSize: '0.1',
    correctorSteps: '10',
    correctorTolerance: '1e-6',
    stepTolerance: '1e-6',
    adaptiveCollocationEnabled: true,
    adaptiveRedistributionEnabled: true,
    adaptiveDefectTolerance: '0.025',
    adaptiveMaxRefinements: '3',
    adaptiveMaxMeshPoints: '512',
    forward: true,
  }
}

function makeHomoclinicFromLargeCycleDraft(
  system: SystemConfig
): HomoclinicFromLargeCycleDraft {
  const parameterName = system.paramNames[0] ?? ''
  const param2Name =
    system.paramNames.find((name) => name !== parameterName) ?? system.paramNames[0] ?? ''
  return {
    name: '',
    parameterName,
    param2Name,
    targetNtst: '40',
    targetNcol: '4',
    freeTime: false,
    freeEps0: true,
    freeEps1: true,
    stepSize: '0.01',
    maxSteps: '300',
    minStepSize: '1e-5',
    maxStepSize: '0.1',
    correctorSteps: '32',
    correctorTolerance: '1e-8',
    stepTolerance: '1e-8',
    forward: true,
  }
}

function makeHomoclinicRestartDraft(system: SystemConfig): HomoclinicRestartDraft {
  const parameterName = system.paramNames[0] ?? ''
  const param2Name =
    system.paramNames.find((name) => name !== parameterName) ?? system.paramNames[0] ?? ''
  return {
    name: '',
    parameterName,
    param2Name,
    targetNtst: '40',
    targetNcol: '4',
    freeTime: false,
    freeEps0: true,
    freeEps1: true,
    stepSize: '0.01',
    maxSteps: '300',
    minStepSize: '1e-5',
    maxStepSize: '0.1',
    correctorSteps: '32',
    correctorTolerance: '1e-8',
    stepTolerance: '1e-8',
    forward: true,
  }
}

function makeHomotopySaddleFromEquilibriumDraft(
  system: SystemConfig
): HomotopySaddleFromEquilibriumDraft {
  const parameterName = system.paramNames[0] ?? ''
  const param2Name =
    system.paramNames.find((name) => name !== parameterName) ?? system.paramNames[0] ?? ''
  return {
    name: '',
    parameterName,
    param2Name,
    ntst: '40',
    ncol: '4',
    eps0: '0.01',
    eps1: '0.1',
    time: '40',
    eps1Tol: '1e-4',
    stepSize: '0.01',
    maxSteps: '300',
    minStepSize: '1e-5',
    maxStepSize: '0.1',
    correctorSteps: '8',
    correctorTolerance: '1e-7',
    stepTolerance: '1e-7',
    forward: true,
  }
}

type ManifoldCapsPreset = 'curve_1d' | 'surface_2d' | 'cycle_2d'

function makeDefaultManifoldCapsDraft(preset: ManifoldCapsPreset = 'curve_1d'): ManifoldCapsDraft {
  if (preset === 'surface_2d') {
    return {
      maxSteps: '300',
      maxPoints: '8000',
      maxRings: '240',
      maxVertices: '50000',
      maxTime: '200',
      maxIterations: '',
    }
  }
  if (preset === 'cycle_2d') {
    return {
      maxSteps: '2000',
      maxPoints: '8000',
      maxRings: '48',
      maxVertices: '8000',
      maxTime: '2',
      maxIterations: '',
    }
  }
  return {
    maxSteps: '2000',
    maxPoints: '20000',
    maxRings: '500',
    maxVertices: '200000',
    maxTime: '1000',
    maxIterations: '2000',
  }
}

function makeEquilibriumManifoldDraft(
  system: SystemConfig,
  equilibrium?: EquilibriumObject | null
): EquilibriumManifoldDraft {
  const mode: EquilibriumManifoldMode =
    system.type === 'map' ? 'curve_1d' : system.varNames.length >= 3 ? 'surface_2d' : 'curve_1d'
  const surfaceDefaults = mode === 'surface_2d'
  const profile: EquilibriumManifoldProfileDraft = surfaceDefaults
    ? 'adaptive_global'
    : 'local_preview'
  const profileDefaults = makeSurfaceProfileDefaults(profile)
  const baseName = equilibrium?.name ?? 'equilibrium'
  return {
    name: suggestDefaultName(mode === 'surface_2d' ? 'manifold2d' : 'manifold1d', {
      sourceName: baseName,
    }),
    mode,
    profile,
    stability: surfaceDefaults ? 'Stable' : 'Unstable',
    direction: 'Both',
    eigIndex: '0',
    eigIndexA: '0',
    eigIndexB: '1',
    eps: '1e-3',
    initialRadius: surfaceDefaults ? profileDefaults.initialRadius : '1e-3',
    targetRadius: surfaceDefaults ? profileDefaults.targetRadius : '5',
    leafDelta: surfaceDefaults ? profileDefaults.leafDelta : '0.002',
    deltaMin: surfaceDefaults ? profileDefaults.deltaMin : '0.001',
    ringPoints: surfaceDefaults ? profileDefaults.ringPoints : '48',
    minSpacing: surfaceDefaults ? profileDefaults.minSpacing : '0.00134',
    maxSpacing: surfaceDefaults ? profileDefaults.maxSpacing : '0.004',
    alphaMin: surfaceDefaults ? profileDefaults.alphaMin : '0.3',
    alphaMax: surfaceDefaults ? profileDefaults.alphaMax : '0.4',
    deltaAlphaMin: surfaceDefaults ? profileDefaults.deltaAlphaMin : '0.1',
    deltaAlphaMax: surfaceDefaults ? profileDefaults.deltaAlphaMax : '1.0',
    integrationDt: surfaceDefaults ? profileDefaults.integrationDt : '0.01',
    targetArclength: surfaceDefaults ? profileDefaults.targetArclength : '10',
    caps: surfaceDefaults ? profileDefaults.caps : makeDefaultManifoldCapsDraft('curve_1d'),
  }
}

function makeEquilibriumManifoldExtensionDraft(
  branch?: ContinuationObject | null
): EquilibriumManifoldExtensionDraft {
  const settings = branch?.manifoldSettings
  const defaultCaps = makeDefaultManifoldCapsDraft(
    branch?.branchType === 'cycle_manifold_2d'
      ? 'cycle_2d'
      : branch?.branchType === 'eq_manifold_2d'
        ? 'surface_2d'
        : 'curve_1d'
  )
  const caps = settings?.caps
  return {
    targetArclength: settings?.target_arclength?.toString() ?? '10',
    integrationDt: settings?.integration_dt?.toString() ?? '0.01',
    caps: {
      maxSteps: caps?.max_steps?.toString() ?? defaultCaps.maxSteps,
      maxPoints: caps?.max_points?.toString() ?? defaultCaps.maxPoints,
      maxRings: caps?.max_rings?.toString() ?? defaultCaps.maxRings,
      maxVertices: caps?.max_vertices?.toString() ?? defaultCaps.maxVertices,
      maxTime: caps?.max_time?.toString() ?? defaultCaps.maxTime,
      maxIterations: caps?.max_iterations?.toString() ?? defaultCaps.maxIterations,
    },
  }
}

function makeLimitCycleManifoldDraft(
  limitCycle?: LimitCycleObject | null
): LimitCycleManifoldDraft {
  const baseName = limitCycle?.name ?? 'limit_cycle'
  return {
    name: suggestDefaultName('manifold2d', { sourceName: baseName }),
    stability: 'Unstable',
    direction: 'Plus',
    algorithm: 'GeodesicRings',
    profile: 'local_preview',
    floquetIndex: '0',
    initialRadius: '1e-3',
    leafDelta: '0.002',
    deltaMin: '0.001',
    ringPoints: '24',
    minSpacing: '0.00134',
    maxSpacing: '0.004',
    alphaMin: '0.3',
    alphaMax: '0.4',
    deltaAlphaMin: '0.1',
    deltaAlphaMax: '1.0',
    integrationDt: '0.01',
    targetArclength: '0.25',
    ntst: Math.max(1, Math.trunc(limitCycle?.ntst ?? 20)).toString(),
    ncol: Math.max(1, Math.trunc(limitCycle?.ncol ?? 4)).toString(),
    caps: makeDefaultManifoldCapsDraft('cycle_2d'),
  }
}

function parseManifoldCapsDraft(
  draft: ManifoldCapsDraft,
  options?: {
    requireMaxTime?: boolean
    requireMaxIterations?: boolean
  }
): { caps: ManifoldTerminationCaps | null; error: string | null } {
  const requireMaxTime = options?.requireMaxTime ?? true
  const requireMaxIterations = options?.requireMaxIterations ?? false
  const max_steps = parseDraftInteger(draft.maxSteps)
  const max_points = parseDraftInteger(draft.maxPoints)
  const max_rings = parseDraftInteger(draft.maxRings)
  const max_vertices = parseDraftInteger(draft.maxVertices)
  const max_time = parseDraftNumber(draft.maxTime)
  const max_iterations = parseDraftInteger(draft.maxIterations)
  if (
    max_steps === null ||
    max_points === null ||
    max_rings === null ||
    max_vertices === null
  ) {
    return { caps: null, error: 'Manifold caps must be numeric.' }
  }
  if (max_steps <= 0 || max_points <= 0 || max_rings <= 0 || max_vertices <= 0) {
    return { caps: null, error: 'Manifold caps must be positive.' }
  }
  if (requireMaxTime && (max_time === null || max_time <= 0)) {
    return { caps: null, error: 'Manifold max time must be positive.' }
  }
  if (
    !requireMaxTime &&
    max_time !== null &&
    max_time <= 0
  ) {
    return { caps: null, error: 'Manifold max time must be positive when provided.' }
  }
  if (requireMaxIterations && (max_iterations === null || max_iterations <= 0)) {
    return { caps: null, error: 'Manifold max iterations must be a positive integer.' }
  }
  if (!requireMaxIterations && max_iterations !== null && max_iterations <= 0) {
    return { caps: null, error: 'Manifold max iterations must be a positive integer.' }
  }
  return {
    caps: {
      max_steps,
      max_points,
      max_rings,
      max_vertices,
      max_time: max_time ?? 1,
      max_iterations: max_iterations ?? undefined,
    },
    error: null,
  }
}

function makeContinuationDraft(system: SystemConfig): ContinuationDraft {
  return {
    name: '',
    parameterName: system.paramNames[0] ?? '',
    stepSize: '0.01',
    maxSteps: '300',
    minStepSize: '1e-5',
    maxStepSize: '0.1',
    correctorSteps: '4',
    correctorTolerance: '1e-6',
    stepTolerance: '1e-6',
    adaptiveCollocationEnabled: true,
    adaptiveRedistributionEnabled: true,
    adaptiveDefectTolerance: '0.025',
    adaptiveMaxRefinements: '3',
    adaptiveMaxMeshPoints: '512',
    forward: true,
  }
}

function buildSuggestedBranchName(
  baseName: string,
  parameterName: string,
  existingNames?: Iterable<string>
): string {
  return suggestDefaultName('continuationBranch', {
    sourceName: baseName,
    parameterName,
    existingNames,
  })
}

function resolveEquilibriumContinuationBaseName(
  equilibriumName: string,
  systemType: SystemConfig['type'],
  mapIterations?: number
): string {
  if (systemType === 'map' && typeof mapIterations === 'number' && mapIterations > 1) {
    return 'cycle'
  }
  return equilibriumName
}

function makeBranchExtensionDraft(
  system: SystemConfig,
  branch?: ContinuationObject | null
): ContinuationDraft {
  const base = makeContinuationDraft(system)
  const defaults = branch?.settings
  const fallbackCorrectorSteps =
    branch?.branchType === 'homoclinic_curve' ? '32' : base.correctorSteps
  return {
    ...base,
    stepSize: defaults?.step_size?.toString() ?? base.stepSize,
    maxSteps: '300',
    minStepSize: defaults?.min_step_size?.toString() ?? base.minStepSize,
    maxStepSize: defaults?.max_step_size?.toString() ?? base.maxStepSize,
    correctorSteps:
      branch?.branchType === 'homoclinic_curve'
        ? '32'
        : defaults?.corrector_steps?.toString() ?? fallbackCorrectorSteps,
    correctorTolerance: defaults?.corrector_tolerance?.toString() ?? base.correctorTolerance,
    stepTolerance: defaults?.step_tolerance?.toString() ?? base.stepTolerance,
    forward: true,
  }
}

function makeCodim1CurveDraft(system: SystemConfig): Codim1CurveDraft {
  return {
    name: '',
    param2Name: system.paramNames[0] ?? '',
    stepSize: '0.01',
    maxSteps: '300',
    minStepSize: '1e-5',
    maxStepSize: '0.1',
    correctorSteps: '10',
    correctorTolerance: '1e-8',
    stepTolerance: '1e-8',
    adaptiveCollocationEnabled: true,
    adaptiveRedistributionEnabled: true,
    adaptiveDefectTolerance: '0.025',
    adaptiveMaxRefinements: '3',
    adaptiveMaxMeshPoints: '512',
    forward: true,
  }
}

function makeIsoperiodicCurveDraft(system: SystemConfig): IsoperiodicCurveDraft {
  const parameterName = system.paramNames[0] ?? ''
  const param2Name =
    system.paramNames.find((name) => name !== parameterName) ?? system.paramNames[0] ?? ''
  return {
    name: '',
    parameterName,
    param2Name,
    stepSize: '0.01',
    maxSteps: '300',
    minStepSize: '1e-5',
    maxStepSize: '0.1',
    correctorSteps: '10',
    correctorTolerance: '1e-8',
    stepTolerance: '1e-8',
    adaptiveCollocationEnabled: true,
    adaptiveRedistributionEnabled: true,
    adaptiveDefectTolerance: '0.025',
    adaptiveMaxRefinements: '3',
    adaptiveMaxMeshPoints: '512',
    forward: true,
  }
}

function makeSystemDraft(system: SystemConfig): SystemDraft {
  const periodicVariables = normalizePeriodicVariables(system).map((entry) => ({
    enabled: entry.enabled,
    period: entry.period.toString(),
  }))
  return {
    name: system.name,
    type: system.type,
    solver: system.solver,
    varNames: [...system.varNames],
    paramNames: [...system.paramNames],
    params: system.params.map((value) => value.toString()),
    equations: [...system.equations],
    periodicVariables,
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

function parseDraftNumber(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function parseDraftInteger(value: string): number | null {
  const parsed = parseDraftNumber(value)
  if (parsed === null || !Number.isInteger(parsed)) return null
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
  const collocationAdaptivity = buildCollocationAdaptivitySettings(draft)

  if (
    stepSize === null ||
    maxSteps === null ||
    minStep === null ||
    maxStep === null ||
    correctorSteps === null ||
    correctorTolerance === null ||
    stepTolerance === null ||
    collocationAdaptivity === null
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
      collocation_adaptivity: collocationAdaptivity,
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
  const collocationAdaptivity = buildCollocationAdaptivitySettings(draft)

  if (
    stepSize === null ||
    maxSteps === null ||
    minStep === null ||
    maxStep === null ||
    correctorSteps === null ||
    correctorTolerance === null ||
    stepTolerance === null ||
    collocationAdaptivity === null
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
      collocation_adaptivity: collocationAdaptivity,
    },
    error: null,
  }
}

function buildSystemConfig(draft: SystemDraft): SystemConfig {
  const varNames = draft.varNames.map((name) => name.trim())
  const periodicVariables = adjustArray(
    draft.periodicVariables,
    varNames.length,
    () => ({ enabled: false, period: DEFAULT_VARIABLE_PERIOD.toString() })
  ).map((entry) => {
    const period = parsePeriodExpression(entry.period) ?? Number.NaN
    return {
      enabled: entry.enabled,
      period,
    }
  })
  return {
    name: draft.name.trim(),
    equations: draft.equations.map((eq) => eq.trim()),
    params: draft.params.map((value) => parseNumber(value) ?? Number.NaN),
    paramNames: draft.paramNames.map((name) => name.trim()),
    varNames,
    periodicVariables,
    solver: draft.solver,
    type: draft.type,
  }
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
    normalizePeriodicVariables(config),
  ])
}

function defaultIsoclineSamples(activeCount: number): number {
  if (activeCount <= 1) return 256
  if (activeCount === 2) return 96
  return 40
}

function resolveIsoclineSourceExpression(
  systemConfig: SystemConfig,
  object: IsoclineObject
): string {
  const source = object.source
  if (source.kind === 'custom') return source.expression
  const index = systemConfig.varNames.indexOf(source.variableName)
  if (index < 0 || index >= systemConfig.equations.length) return ''
  if (source.kind === 'flow_derivative') {
    return systemConfig.equations[index] ?? ''
  }
  return `(${systemConfig.equations[index] ?? ''}) - (${source.variableName})`
}

function isSameNumberArray(a: number[] | undefined, b: number[] | undefined): boolean {
  const left = Array.isArray(a) ? a : []
  const right = Array.isArray(b) ? b : []
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function isSameIsoclineAxes(
  left: IsoclineObject['axes'] | undefined,
  right: IsoclineObject['axes'] | undefined
): boolean {
  if (!left || !right) return !left && !right
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (!a || !b) return false
    if (
      a.variableName !== b.variableName ||
      a.min !== b.min ||
      a.max !== b.max ||
      a.samples !== b.samples
    ) {
      return false
    }
  }
  return true
}

function isSameIsoclineSource(
  left: IsoclineObject['source'],
  right: IsoclineObject['source']
): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'custom' && right.kind === 'custom') {
    return left.expression === right.expression
  }
  if (left.kind === 'flow_derivative' && right.kind === 'flow_derivative') {
    return left.variableName === right.variableName
  }
  if (left.kind === 'map_increment' && right.kind === 'map_increment') {
    return left.variableName === right.variableName
  }
  return false
}

function resolveIsoclineParameters(systemConfig: SystemConfig, object: IsoclineObject): number[] {
  if (
    Array.isArray(object.customParameters) &&
    object.customParameters.length === systemConfig.params.length &&
    object.customParameters.every(Number.isFinite)
  ) {
    return object.customParameters
  }
  return systemConfig.params
}

function buildIsoclineAxisDrafts(
  axes: IsoclineObject['axes']
): Record<string, IsoclineAxisDraft> {
  const drafts: Record<string, IsoclineAxisDraft> = {}
  for (const axis of axes) {
    drafts[axis.variableName] = {
      min: axis.min.toString(),
      max: axis.max.toString(),
      samples: axis.samples.toString(),
    }
  }
  return drafts
}

function buildIsoclineFrozenDrafts(
  varNames: string[],
  frozenState: number[]
): Record<string, string> {
  const drafts: Record<string, string> = {}
  for (let index = 0; index < varNames.length; index += 1) {
    const name = varNames[index]
    drafts[name] = (frozenState[index] ?? 0).toString()
  }
  return drafts
}

function isIsoclineSnapshotStale(systemConfig: SystemConfig, object: IsoclineObject): boolean {
  const snapshot = object.lastComputed
  if (!snapshot) return true
  const expression = resolveIsoclineSourceExpression(systemConfig, object).trim()
  const params = resolveIsoclineParameters(systemConfig, object)
  return !(
    isSameIsoclineSource(snapshot.source, object.source) &&
    snapshot.expression === expression &&
    snapshot.level === object.level &&
    isSameIsoclineAxes(snapshot.axes, object.axes) &&
    isSameNumberArray(snapshot.frozenState, object.frozenState) &&
    isSameNumberArray(snapshot.parameters, params)
  )
}

type FreezableObject = OrbitObject | EquilibriumObject | LimitCycleObject | IsoclineObject

function resolveObjectFrozenValues(
  systemConfig: SystemConfig,
  object: FreezableObject
): Record<string, number> {
  if (object.type === 'isocline') {
    const freeNames = new Set(object.axes.map((axis) => axis.variableName))
    const frozenValuesByVarName: Record<string, number> = {}
    systemConfig.varNames.forEach((name, index) => {
      if (freeNames.has(name)) return
      frozenValuesByVarName[name] = object.frozenState[index] ?? 0
    })
    return frozenValuesByVarName
  }
  return object.frozenVariables?.frozenValuesByVarName ?? {}
}

function resolveObjectCurrentSubsystemSnapshot(
  systemConfig: SystemConfig,
  object: FreezableObject
) {
  const maxFreeVariables = object.type === 'isocline' ? 3 : undefined
  return buildSubsystemSnapshot(
    systemConfig,
    { frozenValuesByVarName: resolveObjectFrozenValues(systemConfig, object) },
    { maxFreeVariables }
  )
}

function hasSubsystemSnapshotMismatch(
  systemConfig: SystemConfig,
  object: FreezableObject
): boolean {
  if (!object.subsystemSnapshot) return false
  if (!isSubsystemSnapshotCompatible(systemConfig, object.subsystemSnapshot)) return true
  const current = resolveObjectCurrentSubsystemSnapshot(systemConfig, object)
  return current.hash !== object.subsystemSnapshot.hash
}

export function InspectorDetailsPanel(props: InspectorDetailsPanelProps) {
  if (props.view === 'system') {
    return (
      <SystemEditorPanel
        systemId={props.system.id}
        config={props.system.config}
        actions={{
          updateSystem: props.onUpdateSystem,
          validateSystem: props.onValidateSystem,
        }}
      />
    )
  }
  const sessionKey = `${props.system.id}:${props.selectedNodeId ?? 'none'}:${buildSystemConfigKey(props.system.config)}`
  return (
    <WorkflowFocusProvider key={sessionKey}>
      <InspectorSelectionSession {...props} />
    </WorkflowFocusProvider>
  )
}

export type InspectorSelectionController = ReturnType<
  typeof useInspectorSelectionController
>

function InspectorSelectionSession(props: InspectorDetailsPanelProps) {
  const scope = useInspectorSelectionController(props)
  return <SelectionInspectorView scope={scope} />
}

function useInspectorSelectionController({
  system,
  selectedNodeId,
  view,
  theme,
  branchPointSelection,
  orbitPointSelection,
  limitCyclePointSelection,
  onBranchPointSelect,
  onOrbitPointSelect,
  onLimitCyclePointSelect,
  onRename,
  onToggleVisibility,
  onUpdateRender,
  onUpdateObjectParams = () => {},
  onUpdateObjectFrozenVariables = () => {},
  onUpdateIsoclineObject = () => {},
  onComputeIsocline = async () => null,
  onUpdateScene,
  onUpdateAnalysisViewport,
  onValidateAnalysisExpression,
  onUpdateBifurcationDiagram,
  onSetLimitCycleRenderTarget,
  onRunOrbit,
  onComputeLyapunovExponents,
  onComputeCovariantLyapunovVectors,
  onSolveEquilibrium,
  onCreateEquilibriumBranch,
  onCreateEquilibriumManifold1D = async () => {},
  onExtendEquilibriumManifold1D = async () => {},
  onExtendManifold2D = async () => {},
  onCreateEquilibriumManifold2D = async () => {},
  onCreateBranchFromPoint,
  onExtendBranch,
  onCreateFoldCurveFromPoint,
  onCreateHopfCurveFromPoint,
  onComputeNormalFormAtPoint = async () => {},
  onCreateCodim2BranchFromPoint = async () => {},
  onCreatePeriodicBranchFromPoint = async () => {},
  onCreateIsoperiodicCurveFromPoint = async () => {},
  onCreateLimitCycleCodim1CurveFromPoint = async () => {},
  onCreateNSCurveFromPoint,
  onCreateLimitCycleFromHopf,
  onCreateLimitCycleFromOrbit,
  onCreateLimitCycleManifold2D = async () => {},
  onComputeLimitCycleFloquetModes = async () => {},
  onCreateCycleFromPD,
  onCreateLimitCycleFromPD,
  onCreateHomoclinicFromLargeCycle = async () => {},
  onCreateHomoclinicFromHomoclinic = async () => {},
  onCreateHomotopySaddleFromEquilibrium = async () => {},
  onCreateHomoclinicFromHomotopySaddle = async () => {},
}: InspectorDetailsPanelProps) {
  const workflowFocus = useWorkflowFocus()
  const node = selectedNodeId ? system.nodes[selectedNodeId] : null
  const object = selectedNodeId ? system.objects[selectedNodeId] : undefined
  const branch = selectedNodeId ? system.branches[selectedNodeId] : undefined
  const orbit = object?.type === 'orbit' ? object : null
  const equilibrium = object?.type === 'equilibrium' ? object : null
  const limitCycle = object?.type === 'limit_cycle' ? object : null
  const isocline = object?.type === 'isocline' ? object : null
  const paramOverrideTarget = orbit || equilibrium || limitCycle || isocline
  const selectedOrbitPointIndex =
    orbitPointSelection && orbitPointSelection.orbitId === selectedNodeId
      ? orbitPointSelection.pointIndex
      : null
  const selectedLimitCyclePointIndex =
    limitCyclePointSelection && limitCyclePointSelection.limitCycleId === selectedNodeId
      ? limitCyclePointSelection.pointIndex
      : null
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
  const [selectionNameDraft, setSelectionNameDraft] = useState('')
  useEffect(() => {
    setSelectionNameDraft(selectionNode?.name ?? '')
  }, [selectionNode?.id, selectionNode?.name])
  const commitSelectionName = useCallback(() => {
    if (!selectionNode) return
    const trimmedName = selectionNameDraft.trim()
    if (trimmedName === selectionNode.name) return
    onRename(selectionNode.id, trimmedName)
  }, [onRename, selectionNameDraft, selectionNode])
  const scene = selectedNodeId
    ? system.scenes.find((entry) => entry.id === selectedNodeId)
    : undefined
  const analysis = selectedNodeId
    ? system.analysisViewports.find((entry) => entry.id === selectedNodeId)
    : undefined
  const diagram = selectedNodeId
    ? system.bifurcationDiagrams.find((entry) => entry.id === selectedNodeId)
    : undefined
  const sceneId = scene?.id ?? null
  const equilibriumName = equilibrium?.name ?? ''
  const branchName = branch?.name ?? ''
  const branchParameterName = branch?.parameterName ?? ''
  const existingObjectNames = useMemo(
    () => Object.values(system.objects).map((entry) => entry.name),
    [system.objects]
  )
  const parentObjectId = object ? selectedNodeId : branch?.parentObjectId ?? null
  const parentObjectName = object?.name ?? branch?.parentObject ?? null
  const existingBranchNames = useMemo(
    () =>
      Object.values(system.branches)
        .filter((entry) => {
          if (parentObjectId && entry.parentObjectId) {
            return entry.parentObjectId === parentObjectId
          }
          return Boolean(parentObjectName) && entry.parentObject === parentObjectName
        })
        .map((entry) => entry.name),
    [parentObjectId, parentObjectName, system.branches]
  )
  const canExtendBranch = Boolean(
    branch &&
      [
        'equilibrium',
        'limit_cycle',
        'homoclinic_curve',
        'fold_curve',
        'hopf_curve',
        'lpc_curve',
        'isoperiodic_curve',
        'pd_curve',
        'ns_curve',
      ].includes(branch.branchType)
  )
  const canExtendInvariantManifold =
    branch?.branchType === 'eq_manifold_1d' ||
    branch?.branchType === 'eq_manifold_2d' ||
    branch?.branchType === 'cycle_manifold_2d'
  const isSurfaceManifoldBranch =
    branch?.branchType === 'eq_manifold_2d' || branch?.branchType === 'cycle_manifold_2d'
  const hasBranch = Boolean(branch)
  const isLimitCycleBranch =
    branch?.branchType === 'limit_cycle' || branch?.branchType === 'isoperiodic_curve'
  const manifoldSurfaceGeometry = useMemo(
    () => resolveManifoldSurfaceGeometryForInspector(branch?.data.manifold_geometry),
    [branch?.data.manifold_geometry]
  )
  const manifoldCurveGeometry = useMemo(
    () => resolveManifoldCurveGeometryForInspector(branch?.data.manifold_geometry),
    [branch?.data.manifold_geometry]
  )
  const manifoldCurveSolverDiagnostics = manifoldCurveGeometry?.solver_diagnostics
  const manifoldSolverDiagnostics = manifoldSurfaceGeometry?.solver_diagnostics
  const manifoldSurfaceRingCount = manifoldSurfaceGeometry?.ring_offsets?.length ?? 0
  const manifoldSurfaceVertexCount =
    manifoldSurfaceGeometry && manifoldSurfaceGeometry.dim > 0
      ? Math.floor(manifoldSurfaceGeometry.vertices_flat.length / manifoldSurfaceGeometry.dim)
      : 0
  const supportsStateSpaceStride = branch
    ? STATE_SPACE_STRIDE_BRANCH_TYPES.has(branch.branchType)
    : false
  const supportsManifoldSurfaceToggle = Boolean(
    branch &&
      MANIFOLD_SURFACE_BRANCH_TYPES.has(branch.branchType) &&
      manifoldSurfaceGeometry
  )
  const nodeRender = selectionNode
    ? { ...DEFAULT_RENDER, ...(selectionNode.render ?? {}) }
    : DEFAULT_RENDER
  const manifoldSurfaceVisible =
    nodeRender.manifoldSurfaceVisible ?? DEFAULT_RENDER.manifoldSurfaceVisible ?? true
  const clvDim = orbit?.covariantVectors?.dim
  const clvPlotDim =
    clvDim ??
    (orbit?.data?.[0] ? orbit.data[0].length - 1 : system.config.varNames.length)
  const clvRender = resolveClvRender(selectionNode?.render?.clv, clvDim)
  const equilibriumEigenpairs = useMemo(
    () => equilibrium?.solution?.eigenpairs ?? [],
    [equilibrium?.solution?.eigenpairs]
  )
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
  const equilibriumEigenvalueMarkerColors = resolveEquilibriumEigenvalueMarkerColors(
    equilibriumEigenpairs,
    equilibriumEigenvectorIndices,
    equilibriumEigenvectorColors
  )
  const equilibriumEigenvectorVisibleSet = new Set(equilibriumEigenvectorRender.vectorIndices)
  const equilibriumPlotDim = equilibrium?.solution?.state?.length ?? system.config.varNames.length
  const equilibriumVectorPlotDim = equilibriumPlotDim >= 3 ? 3 : 2
  const equilibriumHasEigenvectors = Boolean(
    equilibriumEigenpairs.some((pair) => pair.vector.length >= equilibriumVectorPlotDim)
  )
  const equilibriumNeeds2d = equilibriumPlotDim < 2
  const showEquilibriumEigenvectorControls = !equilibriumNeeds2d
  const nodeVisibility = selectionNode?.visibility ?? true
  const showVisibilityToggle =
    selectionNode?.kind === 'object' || selectionNode?.kind === 'branch'
  const branchEntries = useMemo<BranchEntry[]>(() => {
    return Object.entries(system.branches)
      .map(([id, entry]) => ({
        id,
        name: entry.name,
        type: formatBranchType(entry, system.config.type),
        points: entry.data.points.length,
        visible: system.nodes[id]?.visibility ?? true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [system.branches, system.nodes, system.config.type])
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
  const maxSceneAxes = useMemo(
    () => maxSceneAxisCount(system.config.varNames),
    [system.config.varNames]
  )
  const sceneAxisSelection = useMemo(() => {
    if (!scene) return null
    return resolveSceneAxisSelection(system.config.varNames, scene.axisVariables)
  }, [scene, system.config.varNames])
  const showSceneAxisPicker = Boolean(scene && maxSceneAxes >= 2 && sceneAxisSelection)
  const updateSceneAxisCount = useCallback(
    (count: number) => {
      if (!scene) return
      const nextAxes = resolveSceneAxisSelection(system.config.varNames, null, count)
      if (!nextAxes) return
      onUpdateScene(scene.id, {
        axisVariables: nextAxes,
        viewRevision: scene.viewRevision + 1,
        axisRanges: {},
        camera: structuredClone(DEFAULT_SCENE_CAMERA),
      })
    },
    [onUpdateScene, scene, system.config.varNames]
  )
  const updateSceneAxisVariable = useCallback(
    (axisIndex: number, value: string) => {
      if (!scene || !sceneAxisSelection) return
      const nextAxes = [...sceneAxisSelection] as NonNullable<Scene['axisVariables']>
      nextAxes[axisIndex] = value
      const resolved = resolveSceneAxisSelection(
        system.config.varNames,
        nextAxes,
        nextAxes.length
      )
      if (!resolved) return
      onUpdateScene(scene.id, {
        axisVariables: resolved,
      })
    },
    [onUpdateScene, scene, sceneAxisSelection, system.config.varNames]
  )
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
  const prevBranchIdRef = useRef<string | null>(null)
  const prevBranchPointCountRef = useRef(0)
  const prevBranchMinLogicalIndexRef = useRef<number | null>(null)
  const prevBranchMaxLogicalIndexRef = useRef<number | null>(null)
  const internalBranchPointSelectionRef = useRef(false)
  const [branchPointIndex, setBranchPointIndex] = useState<number | null>(null)
  const [branchNavigatorOpen, setBranchNavigatorOpen] = useState(false)
  const branchPointIndexRef = useRef<number | null>(null)
  const selectedBranchPoint = useMemo(() => {
    if (!branch || branchPointIndex === null) return null
    return branch.data.points[branchPointIndex] ?? null
  }, [branch, branchPointIndex])
  const branchSortedIndex =
    branchPointIndex !== null ? branchSortedOrder.indexOf(branchPointIndex) : -1
  const limitCycleRenderTargets = system.ui.limitCycleRenderTargets ?? {}
  const limitCycleRenderTarget =
    limitCycle && selectedNodeId ? limitCycleRenderTargets[selectedNodeId] ?? null : null
  const limitCycleRenderBranch =
    limitCycleRenderTarget?.type === 'branch'
      ? system.branches[limitCycleRenderTarget.branchId]
      : null
  const limitCycleRenderPoint = useMemo(() => {
    if (limitCycleRenderTarget?.type !== 'branch' || !limitCycleRenderBranch) {
      return null
    }
    return limitCycleRenderBranch.data.points[limitCycleRenderTarget.pointIndex] ?? null
  }, [limitCycleRenderBranch, limitCycleRenderTarget])
  const limitCycleRenderLabel = useMemo(() => {
    if (limitCycleRenderTarget?.type !== 'branch' || !limitCycleRenderBranch) {
      return 'Stored cycle'
    }
    const indices = ensureBranchIndices(limitCycleRenderBranch.data)
    const logicalIndex = indices[limitCycleRenderTarget.pointIndex]
    const displayIndex = Number.isFinite(logicalIndex)
      ? logicalIndex
      : limitCycleRenderTarget.pointIndex
    return `${limitCycleRenderBranch.name} @ ${displayIndex}`
  }, [limitCycleRenderBranch, limitCycleRenderTarget])
  const isStoredCycleTarget =
    !limitCycleRenderTarget || limitCycleRenderTarget.type === 'object'
  const canRenderStoredCycle = limitCycle?.origin.type === 'orbit'
  const limitCycleParentId = useMemo(() => {
    if (!branch) return null
    return (
      Object.entries(system.objects).find(
        ([, obj]) => obj.type === 'limit_cycle' && obj.name === branch.parentObject
      )?.[0] ?? null
    )
  }, [branch, system.objects])
  const branchRenderTarget = limitCycleParentId
    ? limitCycleRenderTargets[limitCycleParentId] ?? null
    : null
  const isBranchRenderTarget =
    Boolean(
      branchRenderTarget?.type === 'branch' &&
        selectedNodeId &&
        branchPointIndex !== null &&
        branchRenderTarget.branchId === selectedNodeId &&
        branchRenderTarget.pointIndex === branchPointIndex
    )
  const syncBranchPointSelection = useCallback(
    (arrayIndex: number | null) => {
      if (!onBranchPointSelect || view !== 'selection') return
      if (!branch || arrayIndex === null || !selectedNodeId) {
        if (branchPointSelection !== null) {
          internalBranchPointSelectionRef.current = true
          onBranchPointSelect(null)
        }
        return
      }
      if (
        branchPointSelection &&
        branchPointSelection.branchId === selectedNodeId &&
        branchPointSelection.pointIndex === arrayIndex
      ) {
        return
      }
      internalBranchPointSelectionRef.current = true
      onBranchPointSelect({
        branchId: selectedNodeId,
        pointIndex: arrayIndex,
      })
    },
    [
      branch,
      branchPointSelection,
      onBranchPointSelect,
      selectedNodeId,
      view,
    ]
  )
  const [systemDraft, setSystemDraft] = useState<SystemDraft>(() =>
    makeSystemDraft(system.config)
  )
  const [orbitDraft, setOrbitDraft] = useState<OrbitRunDraft>(() =>
    makeOrbitRunDraft(system.config)
  )
  const [orbitError, setOrbitError] = useState<string | null>(null)
  const [orbitPreviewPage, setOrbitPreviewPage] = useState(0)
  const [orbitPreviewInput, setOrbitPreviewInput] = useState('1')
  const [orbitPreviewError, setOrbitPreviewError] = useState<string | null>(null)
  const [limitCyclePreviewPage, setLimitCyclePreviewPage] = useState(0)
  const [limitCyclePreviewInput, setLimitCyclePreviewInput] = useState('1')
  const [limitCyclePreviewError, setLimitCyclePreviewError] = useState<string | null>(null)
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
  const equilibriumMapIterations =
    systemDraft.type === 'map'
      ? (() => {
          const fromObject =
            equilibrium?.solutionProvenance?.mapIterations ??
            equilibrium?.solution?.cycle_points?.length ??
            equilibrium?.lastSolverParams?.mapIterations
          if (typeof fromObject === 'number' && Number.isFinite(fromObject)) {
            return Math.max(1, Math.trunc(fromObject))
          }
          const parsed = parseNumber(equilibriumDraft.mapIterations)
          return parsed !== null ? Math.max(1, Math.trunc(parsed)) : 1
        })()
      : undefined
  const equilibriumLabel = formatEquilibriumLabel(systemDraft.type, {
    mapIterations: equilibriumMapIterations,
  })
  const equilibriumLabelLower = formatEquilibriumLabel(systemDraft.type, {
    lowercase: true,
    mapIterations: equilibriumMapIterations,
  })
  const equilibriumLabelPluralLower = formatEquilibriumLabel(systemDraft.type, {
    lowercase: true,
    plural: true,
    mapIterations: equilibriumMapIterations,
  })
  const equilibriumContinuationBaseName = resolveEquilibriumContinuationBaseName(
    equilibriumName,
    systemDraft.type,
    equilibriumMapIterations
  )
  const limitCycleFromPDLabel =
    systemDraft.type === 'map' ? 'Cycle from PD' : 'Limit Cycle from PD'
  const selectionTypeLabel =
    selectionNode?.objectType === 'equilibrium'
      ? equilibriumLabelLower
      : selectionNode?.objectType ?? selectionNode?.kind
  const [paramOverrideDraft, setParamOverrideDraft] = useState<string[]>(() =>
    makeParamOverrideDraft(system.config, paramOverrideTarget)
  )
  const [paramOverrideError, setParamOverrideError] = useState<string | null>(null)
  const [frozenVariableDrafts, setFrozenVariableDrafts] = useState<Record<string, string>>({})
  const activeFrozenVariableRef = useRef<string | null>(null)

  const [continuationDraft, setContinuationDraft] = useState<ContinuationDraft>(() =>
    makeContinuationDraft(system.config)
  )
  const [continuationError, setContinuationError] = useState<string | null>(null)
  const [equilibriumManifoldDraft, setEquilibriumManifoldDraft] = useState<EquilibriumManifoldDraft>(
    () => makeEquilibriumManifoldDraft(system.config, equilibrium)
  )
  const [equilibriumManifoldError, setEquilibriumManifoldError] = useState<string | null>(null)
  const [equilibriumManifoldExtensionDraft, setEquilibriumManifoldExtensionDraft] =
    useState<EquilibriumManifoldExtensionDraft>(() =>
      makeEquilibriumManifoldExtensionDraft(branch)
    )
  const [equilibriumManifoldExtensionError, setEquilibriumManifoldExtensionError] =
    useState<string | null>(null)
  const [limitCycleFromOrbitDraft, setLimitCycleFromOrbitDraft] =
    useState<LimitCycleFromOrbitDraft>(() => makeLimitCycleFromOrbitDraft(system.config))
  const [limitCycleFromOrbitError, setLimitCycleFromOrbitError] = useState<string | null>(
    null
  )
  const [limitCycleManifoldDraft, setLimitCycleManifoldDraft] = useState<LimitCycleManifoldDraft>(
    () => makeLimitCycleManifoldDraft(limitCycle)
  )
  const [limitCycleManifoldError, setLimitCycleManifoldError] = useState<string | null>(null)
  const [limitCycleFloquetModesError, setLimitCycleFloquetModesError] = useState<string | null>(
    null
  )
  const [limitCycleFloquetBackend, setLimitCycleFloquetBackend] =
    useState<FloquetBackend>('auto')
  const equilibriumManifoldEligibleIndexOptions = useMemo(() => {
    const wantsUnstable = equilibriumManifoldDraft.stability === 'Unstable'
    const isMap = systemDraft.type === 'map'
    return equilibriumEigenpairs
      .map((pair, index) => ({ pair, index }))
      .filter(({ pair }) => {
        if (isMap) {
          if (Math.abs(pair.value.im) > 1e-8) return false
          const modulus = Math.hypot(pair.value.re, pair.value.im)
          return wantsUnstable ? modulus > 1 + 1e-6 : modulus < 1 - 1e-6
        }
        return wantsUnstable ? pair.value.re > 1e-9 : pair.value.re < -1e-9
      })
      .map(({ index }) => ({
        value: index.toString(),
        label: (index + 1).toString(),
      }))
  }, [equilibriumEigenpairs, equilibriumManifoldDraft.stability, systemDraft.type])
  const equilibriumManifoldEligibleRealIndexOptions = useMemo(() => {
    const wantsUnstable = equilibriumManifoldDraft.stability === 'Unstable'
    const isMap = systemDraft.type === 'map'
    return equilibriumEigenpairs
      .map((pair, index) => ({ pair, index }))
      .filter(({ pair }) => {
        if (Math.abs(pair.value.im) > 1e-8) return false
        if (isMap) {
          const modulus = Math.hypot(pair.value.re, pair.value.im)
          return wantsUnstable ? modulus > 1 + 1e-6 : modulus < 1 - 1e-6
        }
        return wantsUnstable ? pair.value.re > 1e-9 : pair.value.re < -1e-9
      })
      .map(({ index }) => ({
        value: index.toString(),
        label: (index + 1).toString(),
      }))
  }, [equilibriumEigenpairs, equilibriumManifoldDraft.stability, systemDraft.type])
  const equilibriumManifoldEligibleIndexSet = useMemo(
    () => new Set(equilibriumManifoldEligibleIndexOptions.map((option) => option.value)),
    [equilibriumManifoldEligibleIndexOptions]
  )
  const equilibriumManifoldEligibleRealIndexSet = useMemo(
    () => new Set(equilibriumManifoldEligibleRealIndexOptions.map((option) => option.value)),
    [equilibriumManifoldEligibleRealIndexOptions]
  )
  const equilibriumManifoldSupportsSurface = systemDraft.varNames.length >= 3
  const equilibriumManifoldModeOptions = useMemo(
    (): Array<{ value: EquilibriumManifoldMode; label: string }> => {
      if (systemDraft.type === 'map') {
        return [{ value: 'curve_1d', label: '1D curve' }]
      }
      const options: Array<{ value: EquilibriumManifoldMode; label: string }> = []
      if (
        equilibriumManifoldEligibleIndexOptions.length === 1 &&
        equilibriumManifoldEligibleRealIndexOptions.length === 1
      ) {
        options.push({ value: 'curve_1d', label: '1D curve' })
      }
      if (
        equilibriumManifoldSupportsSurface &&
        equilibriumManifoldEligibleIndexOptions.length >= 2
      ) {
        options.push({ value: 'surface_2d', label: '2D surface' })
      }
      if (options.length > 0) {
        return options
      }
      return equilibriumManifoldSupportsSurface
        ? [
            { value: 'curve_1d', label: '1D curve' },
            { value: 'surface_2d', label: '2D surface' },
          ]
        : [{ value: 'curve_1d', label: '1D curve' }]
    },
    [
      equilibriumManifoldEligibleIndexOptions.length,
      equilibriumManifoldEligibleRealIndexOptions.length,
      equilibriumManifoldSupportsSurface,
      systemDraft.type,
    ]
  )
  const equilibriumManifoldModeOptionSet = useMemo(
    () => new Set(equilibriumManifoldModeOptions.map((option) => option.value)),
    [equilibriumManifoldModeOptions]
  )
  const [limitCycleFromHopfDraft, setLimitCycleFromHopfDraft] =
    useState<LimitCycleFromHopfDraft>(() => makeLimitCycleFromHopfDraft(system.config))
  const [limitCycleFromHopfError, setLimitCycleFromHopfError] = useState<string | null>(
    null
  )
  const [limitCycleFromPDDraft, setLimitCycleFromPDDraft] = useState<LimitCycleFromPDDraft>(
    () => makeLimitCycleFromPDDraft()
  )
  const [limitCycleFromPDError, setLimitCycleFromPDError] = useState<string | null>(null)
  const [homoclinicFromLargeCycleDraft, setHomoclinicFromLargeCycleDraft] =
    useState<HomoclinicFromLargeCycleDraft>(() =>
      makeHomoclinicFromLargeCycleDraft(system.config)
    )
  const [homoclinicFromLargeCycleError, setHomoclinicFromLargeCycleError] = useState<
    string | null
  >(null)
  const [homoclinicFromHomoclinicDraft, setHomoclinicFromHomoclinicDraft] =
    useState<HomoclinicRestartDraft>(() => makeHomoclinicRestartDraft(system.config))
  const [homoclinicFromHomoclinicError, setHomoclinicFromHomoclinicError] = useState<
    string | null
  >(null)
  const [
    homotopySaddleFromEquilibriumDraft,
    setHomotopySaddleFromEquilibriumDraft,
  ] = useState<HomotopySaddleFromEquilibriumDraft>(() =>
    makeHomotopySaddleFromEquilibriumDraft(system.config)
  )
  const [homotopySaddleFromEquilibriumError, setHomotopySaddleFromEquilibriumError] =
    useState<string | null>(null)
  const [homoclinicFromHomotopySaddleDraft, setHomoclinicFromHomotopySaddleDraft] =
    useState<HomoclinicRestartDraft>(() => makeHomoclinicRestartDraft(system.config))
  const [homoclinicFromHomotopySaddleError, setHomoclinicFromHomotopySaddleError] = useState<
    string | null
  >(null)
  const [foldCurveDraft, setFoldCurveDraft] = useState<Codim1CurveDraft>(() =>
    makeCodim1CurveDraft(system.config)
  )
  const [foldCurveError, setFoldCurveError] = useState<string | null>(null)
  const [hopfCurveDraft, setHopfCurveDraft] = useState<Codim1CurveDraft>(() =>
    makeCodim1CurveDraft(system.config)
  )
  const [hopfCurveError, setHopfCurveError] = useState<string | null>(null)
  const [isoperiodicCurveDraft, setIsoperiodicCurveDraft] = useState<IsoperiodicCurveDraft>(() =>
    makeIsoperiodicCurveDraft(system.config)
  )
  const [isoperiodicCurveError, setIsoperiodicCurveError] = useState<string | null>(null)
  const [limitCycleCodim1CurveDraft, setLimitCycleCodim1CurveDraft] =
    useState<Codim1CurveDraft>(() => makeCodim1CurveDraft(system.config))
  const [limitCycleCodim1CurveTarget, setLimitCycleCodim1CurveTarget] =
    useState<LimitCycleCodim1CurveTarget | null>(null)
  const [limitCycleCodim1CurveError, setLimitCycleCodim1CurveError] = useState<
    string | null
  >(null)
  const [nsCurveDraft, setNSCurveDraft] = useState<Codim1CurveDraft>(() =>
    makeCodim1CurveDraft(system.config)
  )
  const [nsCurveError, setNSCurveError] = useState<string | null>(null)
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
  const isoclineComputeControllerRef = useRef<AbortController | null>(null)
  const isoclineSelectionIdRef = useRef<string | null>(null)
  const [isoclineError, setIsoclineError] = useState<string | null>(null)
  const [isoclineComputing, setIsoclineComputing] = useState(false)
  const [isoclineLevelDraft, setIsoclineLevelDraft] = useState('')
  const [isoclineAxisDrafts, setIsoclineAxisDrafts] = useState<Record<string, IsoclineAxisDraft>>(
    {}
  )
  const [isoclineFrozenDrafts, setIsoclineFrozenDrafts] = useState<Record<string, string>>({})
  const isoclineMaxActiveVariables = Math.min(systemDraft.varNames.length, 3)
  const isoclineActiveSet = useMemo(() => {
    if (!isocline) return new Set<string>()
    return new Set(isocline.axes.map((axis) => axis.variableName))
  }, [isocline])
  const isoclineActiveAxes = useMemo(() => {
    if (!isocline) return []
    return systemDraft.varNames
      .map((name) => isocline.axes.find((axis) => axis.variableName === name))
      .filter((axis): axis is IsoclineObject['axes'][number] => Boolean(axis))
  }, [isocline, systemDraft.varNames])
  const isoclineFrozenVariables = useMemo(() => {
    if (!isocline) return []
    return systemDraft.varNames
      .map((name, index) => ({
        name,
        index,
        value: isocline.frozenState[index] ?? 0,
      }))
      .filter((entry) => !isoclineActiveSet.has(entry.name))
  }, [isocline, isoclineActiveSet, systemDraft.varNames])
  const isoclineResolvedExpression = useMemo(() => {
    if (!isocline) return ''
    return resolveIsoclineSourceExpression(system.config, isocline)
  }, [isocline, system.config])
  const isoclineStale = useMemo(() => {
    if (!isocline) return false
    return isIsoclineSnapshotStale(system.config, isocline)
  }, [isocline, system.config])
  const isMapSystem = systemDraft.type === 'map'
  const isoclineSourceKind = useMemo(() => {
    if (!isocline) return 'custom'
    if (isocline.source.kind === 'custom') return 'custom'
    return isMapSystem ? 'map_increment' : 'flow_derivative'
  }, [isMapSystem, isocline])
  const isoclineSourceVariable = useMemo(() => {
    if (!isocline) return systemDraft.varNames[0] ?? ''
    if (isocline.source.kind === 'custom') return systemDraft.varNames[0] ?? ''
    return systemDraft.varNames.includes(isocline.source.variableName)
      ? isocline.source.variableName
      : systemDraft.varNames[0] ?? ''
  }, [isocline, systemDraft.varNames])
  const orbitSnapshot = useMemo(() => {
    if (!orbit) return null
    if (
      orbit.subsystemSnapshot &&
      isSubsystemSnapshotCompatible(system.config, orbit.subsystemSnapshot)
    ) {
      return orbit.subsystemSnapshot
    }
    return buildSubsystemSnapshot(system.config, orbit.frozenVariables)
  }, [orbit, system.config])
  const orbitDisplayRows = useMemo(() => {
    if (!orbit || orbit.data.length === 0) return []
    if (!orbitSnapshot) return orbit.data
    return mapStateRowsToDisplay(orbitSnapshot, orbit.data)
  }, [orbit, orbitSnapshot])
  const orbitPreviewPageCount = useMemo(() => {
    if (orbitDisplayRows.length === 0) return 0
    return Math.ceil(orbitDisplayRows.length / ORBIT_PREVIEW_PAGE_SIZE)
  }, [orbitDisplayRows])
  const orbitPreviewVarNames = useMemo(() => {
    if (!orbit || orbitDisplayRows.length === 0) return []
    const baseNames =
      orbitSnapshot?.baseVarNames.length === systemDraft.varNames.length
        ? orbitSnapshot.baseVarNames
        : systemDraft.varNames
    return baseNames.map((name, index) => {
      const fallback = name || `x${index + 1}`
      return orbitSnapshot && isVariableFrozen(orbitSnapshot, name)
        ? `${fallback}*`
        : fallback
    })
  }, [orbit, orbitDisplayRows.length, orbitSnapshot, systemDraft.varNames])
  const orbitPreviewStart = orbitPreviewPage * ORBIT_PREVIEW_PAGE_SIZE
  const orbitPreviewEnd = Math.min(
    orbitPreviewStart + ORBIT_PREVIEW_PAGE_SIZE,
    orbitDisplayRows.length
  )
  const orbitPreviewRows = orbitDisplayRows.slice(orbitPreviewStart, orbitPreviewEnd)
  const selectedOrbitPoint =
    orbitDisplayRows.length > 0 &&
    selectedOrbitPointIndex !== null &&
    selectedOrbitPointIndex >= 0 &&
    selectedOrbitPointIndex < orbitDisplayRows.length
      ? orbitDisplayRows[selectedOrbitPointIndex]
      : null
  const selectedOrbitState = selectedOrbitPoint ? selectedOrbitPoint.slice(1) : null
  const limitCycleSnapshot = useMemo(() => {
    if (!limitCycle) return null
    if (
      limitCycle.subsystemSnapshot &&
      isSubsystemSnapshotCompatible(system.config, limitCycle.subsystemSnapshot)
    ) {
      return limitCycle.subsystemSnapshot
    }
    return buildSubsystemSnapshot(system.config, limitCycle.frozenVariables)
  }, [limitCycle, system.config])
  const limitCycleStateDimension =
    limitCycleSnapshot?.freeVariableNames.length ?? system.config.varNames.length
  const limitCycleDisplayProjection = useMemo(() => {
    if (!limitCycle) return undefined
    if (limitCycle.parameterRef?.kind === 'frozen_var' && Number.isFinite(limitCycle.paramValue)) {
      return {
        parameterRef: limitCycle.parameterRef,
        paramValue: limitCycle.paramValue,
      }
    }
    return undefined
  }, [limitCycle])
  const limitCycleProfilePoints = useMemo(() => {
    if (!limitCycle) return []
    const dim = limitCycleStateDimension
    if (dim <= 0) return []
    const { profilePoints } = extractLimitCycleProfile(
      limitCycle.state,
      dim,
      limitCycle.ntst,
      limitCycle.ncol,
      { layout: 'mesh-first' }
    )
    if (!limitCycleSnapshot) return profilePoints
    return profilePoints.map((point) =>
      stateVectorToDisplay(limitCycleSnapshot, point, limitCycleDisplayProjection)
    )
  }, [
    limitCycle,
    limitCycleDisplayProjection,
    limitCycleSnapshot,
    limitCycleStateDimension,
  ])
  const limitCyclePreviewPageCount = useMemo(() => {
    if (limitCycleProfilePoints.length === 0) return 0
    return Math.ceil(limitCycleProfilePoints.length / ORBIT_PREVIEW_PAGE_SIZE)
  }, [limitCycleProfilePoints.length])
  const limitCyclePreviewVarNames = useMemo(() => {
    if (!limitCycle || limitCycleProfilePoints.length === 0) return []
    const baseNames =
      limitCycleSnapshot?.baseVarNames.length === systemDraft.varNames.length
        ? limitCycleSnapshot.baseVarNames
        : systemDraft.varNames
    return baseNames.map((name, index) => {
      const fallback = name || `x${index + 1}`
      return limitCycleSnapshot && isVariableFrozen(limitCycleSnapshot, name)
        ? `${fallback}*`
        : fallback
    })
  }, [limitCycle, limitCycleProfilePoints.length, limitCycleSnapshot, systemDraft.varNames])
  const limitCyclePreviewStart = limitCyclePreviewPage * ORBIT_PREVIEW_PAGE_SIZE
  const limitCyclePreviewEnd = Math.min(
    limitCyclePreviewStart + ORBIT_PREVIEW_PAGE_SIZE,
    limitCycleProfilePoints.length
  )
  const limitCyclePreviewRows = limitCycleProfilePoints.slice(
    limitCyclePreviewStart,
    limitCyclePreviewEnd
  )
  const selectedLimitCyclePoint =
    selectedLimitCyclePointIndex !== null &&
    selectedLimitCyclePointIndex >= 0 &&
    selectedLimitCyclePointIndex < limitCycleProfilePoints.length
      ? limitCycleProfilePoints[selectedLimitCyclePointIndex]
      : null
  const limitCycleMesh = useMemo(() => {
    if (
      !branch ||
      (branch.branchType !== 'limit_cycle' && branch.branchType !== 'isoperiodic_curve')
    ) {
      return { ntst: 20, ncol: 4 }
    }
    const branchType = branch.data.branch_type
    if (branchType?.type === 'LimitCycle' || branchType?.type === 'IsoperiodicCurve') {
      return { ntst: branchType.ntst, ncol: branchType.ncol }
    }
    return { ntst: 20, ncol: 4 }
  }, [branch])

  const limitCyclePointMetrics = useMemo(() => {
    if (
      !branch ||
      (branch.branchType !== 'limit_cycle' && branch.branchType !== 'isoperiodic_curve') ||
      !selectedBranchPoint
    ) {
      return null
    }
    const snapshot =
      branch.subsystemSnapshot &&
      isSubsystemSnapshotCompatible(system.config, branch.subsystemSnapshot)
        ? branch.subsystemSnapshot
        : null
    const stateDimension = snapshot?.freeVariableNames.length ?? systemDraft.varNames.length
    if (stateDimension <= 0) return null
    const projection: {
      parameterRef?: ContinuationObject['parameterRef']
      paramValue?: number
      parameter2Ref?: ContinuationObject['parameter2Ref']
      param2Value?: number
    } = {}
    if (branch.parameterRef?.kind === 'frozen_var' && Number.isFinite(selectedBranchPoint.param_value)) {
      projection.parameterRef = branch.parameterRef
      projection.paramValue = selectedBranchPoint.param_value
    }
    const pointBranchType = branch.data.branch_type
    const pointParam2Ref =
      pointBranchType &&
      typeof pointBranchType === 'object' &&
      'param2_ref' in pointBranchType &&
      pointBranchType.param2_ref
        ? pointBranchType.param2_ref
        : branch.parameter2Ref
    if (pointParam2Ref?.kind === 'frozen_var') {
      const param2Value = Number.isFinite(selectedBranchPoint.param2_value)
        ? selectedBranchPoint.param2_value
        : resolveContinuationPointParam2Value(
            selectedBranchPoint,
            pointBranchType,
            stateDimension
          )
      if (Number.isFinite(param2Value)) {
        projection.parameter2Ref = pointParam2Ref
        projection.param2Value = param2Value as number
      }
    }
    const { profilePoints, period } = extractLimitCycleProfile(
      selectedBranchPoint.state,
      stateDimension,
      limitCycleMesh.ntst,
      limitCycleMesh.ncol,
      { layout: branch.branchType === 'isoperiodic_curve' ? 'stage-first' : 'mesh-first' }
    )
    if (profilePoints.length === 0) return null
    const displayProfilePoints = snapshot
      ? profilePoints.map((point) => stateVectorToDisplay(snapshot, point, projection))
      : profilePoints
    const metrics = computeLimitCycleMetrics(displayProfilePoints, period)
    const stability =
      selectedBranchPoint.stability && selectedBranchPoint.stability !== 'None'
        ? selectedBranchPoint.stability
        : interpretLimitCycleStability(selectedBranchPoint.eigenvalues)
    return { metrics, stability }
  }, [
    branch,
    limitCycleMesh.ncol,
    limitCycleMesh.ntst,
    selectedBranchPoint,
    system.config,
    systemDraft.varNames.length,
  ])

  const limitCycleFromPDNameSuggestion = useMemo(() => {
    return suggestDefaultName('periodDoubledCycle', {
      entityLabel: systemDraft.type === 'map' ? 'Cycle' : 'LC',
      sourceName: branch?.name ?? 'source',
      pointIndex: branchPointIndex ?? 0,
      existingNames: existingObjectNames,
    })
  }, [branch?.name, branchPointIndex, existingObjectNames, systemDraft.type])

  const limitCycleFromPDBranchSuggestion = useMemo(() => {
    const baseName =
      limitCycleFromPDDraft.limitCycleName.trim() || limitCycleFromPDNameSuggestion
    return suggestDefaultName('continuationBranch', {
      sourceName: baseName,
      parameterName: branchParameterName,
    })
  }, [
    branchParameterName,
    limitCycleFromPDDraft.limitCycleName,
    limitCycleFromPDNameSuggestion,
  ])

  const selectedSubsystemSnapshot = useMemo(() => {
    if (paramOverrideTarget) {
      return resolveObjectCurrentSubsystemSnapshot(system.config, paramOverrideTarget)
    }
    if (branch?.subsystemSnapshot && isSubsystemSnapshotCompatible(system.config, branch.subsystemSnapshot)) {
      return branch.subsystemSnapshot
    }
    return buildSubsystemSnapshot(system.config)
  }, [branch?.subsystemSnapshot, paramOverrideTarget, system.config])

  const continuationParameterLabels = useMemo(
    () =>
      continuationParameterOptions(system.config, selectedSubsystemSnapshot).map((option) =>
        formatParameterRefLabel(option.ref)
      ),
    [selectedSubsystemSnapshot, system.config]
  )
  const continuationParameterSet = useMemo(
    () => new Set(continuationParameterLabels),
    [continuationParameterLabels]
  )
  const continuationParameterCount = continuationParameterLabels.length
  const firstContinuationParameter = continuationParameterLabels[0] ?? ''
  const currentObjectFrozenValues = useMemo(() => {
    if (!paramOverrideTarget) return {}
    return resolveObjectFrozenValues(system.config, paramOverrideTarget)
  }, [paramOverrideTarget, system.config])
  const subsystemSnapshotMismatch = useMemo(() => {
    if (!paramOverrideTarget) return false
    return hasSubsystemSnapshotMismatch(system.config, paramOverrideTarget)
  }, [paramOverrideTarget, system.config])
  const frozenVariableHeaderNames = useMemo(
    () =>
      systemDraft.varNames.map((name, index) => {
        const fallback = name || `x${index + 1}`
        return isVariableFrozen(selectedSubsystemSnapshot, name)
          ? `${fallback}*`
          : fallback
      }),
    [selectedSubsystemSnapshot, systemDraft.varNames]
  )

  useEffect(() => {
    activeFrozenVariableRef.current = null
  }, [selectedNodeId])

  useEffect(() => {
    if (!paramOverrideTarget || paramOverrideTarget.type === 'isocline') {
      setFrozenVariableDrafts({})
      return
    }
    setFrozenVariableDrafts((prev) => {
      const next: Record<string, string> = {}
      for (let index = 0; index < systemDraft.varNames.length; index += 1) {
        const name = systemDraft.varNames[index]
        if (!name) continue
        const value =
          currentObjectFrozenValues[name] ??
          (paramOverrideTarget.subsystemSnapshot?.frozenValuesByVarName?.[name] ?? 0)
        const committed = value.toString()
        if (
          activeFrozenVariableRef.current === name &&
          Object.prototype.hasOwnProperty.call(prev, name)
        ) {
          next[name] = prev[name]
        } else {
          next[name] = committed
        }
      }
      return next
    })
  }, [currentObjectFrozenValues, paramOverrideTarget, systemDraft.varNames])

  useEffect(() => {
    setOrbitPreviewPage(0)
    setOrbitPreviewInput('1')
    setOrbitPreviewError(null)
  }, [selectedNodeId, orbitDisplayRows.length])

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
    setParamOverrideDraft((prev) =>
      adjustArray(prev, systemDraft.paramNames.length, () => '0')
    )
  }, [systemDraft.paramNames.length, systemDraft.varNames.length])

  useEffect(() => {
    if (systemDraft.type === 'map') {
      setSystemDraft((prev) => ({ ...prev, solver: 'discrete' }))
    } else if (!FLOW_SOLVERS.includes(systemDraft.solver)) {
      setSystemDraft((prev) => ({ ...prev, solver: 'rk4' }))
    }
  }, [systemDraft.type, systemDraft.solver])

  useEffect(() => {
    const firstParam = continuationParameterLabels[0] ?? ''
    const resolveDistinctParam = (paramName: string) =>
      continuationParameterLabels.find((name) => name !== paramName) ?? firstParam

    setContinuationDraft((prev) => {
      if (continuationParameterLabels.length === 0) {
        if (!prev.parameterName) return prev
        return { ...prev, parameterName: '' }
      }
      if (continuationParameterSet.has(prev.parameterName)) {
        return prev
      }
      return { ...prev, parameterName: firstParam }
    })
    setLimitCycleFromOrbitDraft((prev) => {
      if (continuationParameterLabels.length === 0) {
        if (!prev.parameterName) return prev
        return { ...prev, parameterName: '' }
      }
      if (continuationParameterSet.has(prev.parameterName)) {
        return prev
      }
      return { ...prev, parameterName: firstParam }
    })
    setLimitCycleFromHopfDraft((prev) => {
      if (continuationParameterLabels.length === 0) {
        if (!prev.parameterName) return prev
        return { ...prev, parameterName: '' }
      }
      if (continuationParameterSet.has(prev.parameterName)) {
        return prev
      }
      return { ...prev, parameterName: firstParam }
    })
    setHomoclinicFromLargeCycleDraft((prev) => {
      if (continuationParameterLabels.length === 0) {
        if (!prev.parameterName && !prev.param2Name) return prev
        return { ...prev, parameterName: '', param2Name: '' }
      }
      const parameterName = continuationParameterSet.has(prev.parameterName)
        ? prev.parameterName
        : firstParam
      const param2Name =
        continuationParameterSet.has(prev.param2Name) && prev.param2Name !== parameterName
          ? prev.param2Name
          : resolveDistinctParam(parameterName)
      return { ...prev, parameterName, param2Name }
    })
    setHomoclinicFromHomoclinicDraft((prev) => {
      if (continuationParameterLabels.length === 0) {
        if (!prev.parameterName && !prev.param2Name) return prev
        return { ...prev, parameterName: '', param2Name: '' }
      }
      const parameterName = continuationParameterSet.has(prev.parameterName)
        ? prev.parameterName
        : firstParam
      const param2Name =
        continuationParameterSet.has(prev.param2Name) && prev.param2Name !== parameterName
          ? prev.param2Name
          : resolveDistinctParam(parameterName)
      return { ...prev, parameterName, param2Name }
    })
    setHomotopySaddleFromEquilibriumDraft((prev) => {
      if (continuationParameterLabels.length === 0) {
        if (!prev.parameterName && !prev.param2Name) return prev
        return { ...prev, parameterName: '', param2Name: '' }
      }
      const parameterName = continuationParameterSet.has(prev.parameterName)
        ? prev.parameterName
        : firstParam
      const param2Name =
        continuationParameterSet.has(prev.param2Name) && prev.param2Name !== parameterName
          ? prev.param2Name
          : resolveDistinctParam(parameterName)
      return { ...prev, parameterName, param2Name }
    })
    setBranchContinuationDraft((prev) => {
      if (continuationParameterLabels.length === 0) {
        if (!prev.parameterName) return prev
        return { ...prev, parameterName: '' }
      }
      if (continuationParameterSet.has(prev.parameterName)) {
        return prev
      }
      return { ...prev, parameterName: firstParam }
    })
    setFoldCurveDraft((prev) => {
      if (continuationParameterLabels.length === 0) {
        if (!prev.param2Name) return prev
        return { ...prev, param2Name: '' }
      }
      if (continuationParameterSet.has(prev.param2Name)) {
        return prev
      }
      return { ...prev, param2Name: firstParam }
    })
    setHopfCurveDraft((prev) => {
      if (continuationParameterLabels.length === 0) {
        if (!prev.param2Name) return prev
        return { ...prev, param2Name: '' }
      }
      if (continuationParameterSet.has(prev.param2Name)) {
        return prev
      }
      return { ...prev, param2Name: firstParam }
    })
    setIsoperiodicCurveDraft((prev) => {
      if (continuationParameterLabels.length === 0) {
        if (!prev.parameterName && !prev.param2Name) return prev
        return { ...prev, parameterName: '', param2Name: '' }
      }
      const parameterName = continuationParameterSet.has(prev.parameterName)
        ? prev.parameterName
        : firstParam
      const param2Name =
        continuationParameterSet.has(prev.param2Name) && prev.param2Name !== parameterName
          ? prev.param2Name
          : resolveDistinctParam(parameterName)
      return { ...prev, parameterName, param2Name }
    })
    setLimitCycleCodim1CurveDraft((prev) => {
      if (continuationParameterLabels.length === 0) {
        if (!prev.param2Name) return prev
        return { ...prev, param2Name: '' }
      }
      if (continuationParameterSet.has(prev.param2Name)) {
        return prev
      }
      return { ...prev, param2Name: firstParam }
    })
    setNSCurveDraft((prev) => {
      if (continuationParameterLabels.length === 0) {
        if (!prev.param2Name) return prev
        return { ...prev, param2Name: '' }
      }
      if (continuationParameterSet.has(prev.param2Name)) {
        return prev
      }
      return { ...prev, param2Name: firstParam }
    })
  }, [continuationParameterLabels, continuationParameterSet])

  useEffect(() => {
    const current = objectRef.current
    if (!current) return
    const stableSystemConfig = stableSystemConfigRef.current
    if (
      current.type === 'orbit' ||
      current.type === 'equilibrium' ||
      current.type === 'limit_cycle' ||
      current.type === 'isocline'
    ) {
      setParamOverrideDraft(makeParamOverrideDraft(stableSystemConfig, current))
      setParamOverrideError(null)
    }
    if (current.type === 'orbit') {
      setOrbitDraft(makeOrbitRunDraft(stableSystemConfig, current))
      setLyapunovDraft(makeLyapunovDraft())
      setCovariantDraft(makeCovariantLyapunovDraft())
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
      setEquilibriumManifoldDraft((prev) => ({
        ...makeEquilibriumManifoldDraft(stableSystemConfig, current),
        mode:
          stableSystemConfig.varNames.length >= 3
            ? prev.mode
            : 'curve_1d',
      }))
      setEquilibriumManifoldError(null)
    }
    if (current.type === 'limit_cycle') {
      setLimitCycleManifoldDraft((prev) => ({
        ...makeLimitCycleManifoldDraft(current),
        name: prev.name.trim().length > 0 ? prev.name : makeLimitCycleManifoldDraft(current).name,
      }))
      setLimitCycleManifoldError(null)
    }
    if (current.type === 'isocline') {
      setIsoclineError(null)
      setIsoclineLevelDraft(current.level.toString())
      setIsoclineAxisDrafts(buildIsoclineAxisDrafts(current.axes))
      setIsoclineFrozenDrafts(
        buildIsoclineFrozenDrafts(stableSystemConfig.varNames, current.frozenState)
      )
      isoclineSelectionIdRef.current = selectedNodeId
    }
  }, [object?.type, selectedNodeId, systemConfigKey])

  useEffect(() => {
    return () => {
      isoclineComputeControllerRef.current?.abort()
      isoclineComputeControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (isocline) return
    isoclineComputeControllerRef.current?.abort()
    isoclineComputeControllerRef.current = null
    isoclineSelectionIdRef.current = null
    setIsoclineComputing(false)
    setIsoclineError(null)
    setIsoclineLevelDraft('')
    setIsoclineAxisDrafts({})
    setIsoclineFrozenDrafts({})
  }, [isocline])

  useEffect(() => {
    if (!isocline || !selectedNodeId) return
    const selectionChanged = isoclineSelectionIdRef.current !== selectedNodeId
    isoclineSelectionIdRef.current = selectedNodeId
    if (selectionChanged) {
      setIsoclineLevelDraft(isocline.level.toString())
      setIsoclineAxisDrafts(buildIsoclineAxisDrafts(isocline.axes))
      setIsoclineFrozenDrafts(buildIsoclineFrozenDrafts(systemDraft.varNames, isocline.frozenState))
      return
    }

    setIsoclineAxisDrafts((prev) => {
      const next: Record<string, IsoclineAxisDraft> = {}
      for (const axis of isocline.axes) {
        const current = prev[axis.variableName]
        next[axis.variableName] = {
          min: current?.min ?? axis.min.toString(),
          max: current?.max ?? axis.max.toString(),
          samples: current?.samples ?? axis.samples.toString(),
        }
      }
      return next
    })

    setIsoclineFrozenDrafts((prev) => {
      const next: Record<string, string> = {}
      for (let index = 0; index < systemDraft.varNames.length; index += 1) {
        const name = systemDraft.varNames[index]
        next[name] = prev[name] ?? (isocline.frozenState[index] ?? 0).toString()
      }
      return next
    })
  }, [isocline, selectedNodeId, systemDraft.varNames])

  useEffect(() => {
    if (!sceneId) return
    setSceneSearch('')
  }, [sceneId])

  useEffect(() => {
    if (!equilibriumName) return
    setContinuationDraft((prev) => {
      const paramName = continuationParameterSet.has(prev.parameterName)
        ? prev.parameterName
        : firstContinuationParameter
      const suggestedName = suggestDefaultName('equilibriumContinuation', {
        sourceName: equilibriumContinuationBaseName,
        parameterName: paramName,
        existingNames: existingBranchNames,
      })
      const nextName = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, parameterName: paramName, name: nextName }
    })
  }, [
    equilibriumContinuationBaseName,
    equilibriumName,
    firstContinuationParameter,
    continuationParameterSet,
    existingBranchNames,
  ])

  useEffect(() => {
    if (!equilibrium) return
    setEquilibriumManifoldDraft((prev) => {
      const supportsSurface = systemDraft.type !== 'map' && systemDraft.varNames.length >= 3
      const mode = supportsSurface ? prev.mode : 'curve_1d'
      const defaultName = suggestDefaultName(
        mode === 'surface_2d' ? 'manifold2d' : 'manifold1d',
        { sourceName: equilibrium.name, existingNames: existingBranchNames }
      )
      const name = prev.name.trim().length > 0 ? prev.name : defaultName
      return { ...prev, mode, name }
    })
  }, [
    equilibrium,
    existingBranchNames,
    systemDraft.type,
    systemDraft.varNames.length,
  ])

  useEffect(() => {
    setEquilibriumManifoldDraft((prev) => {
      let changed = false
      let next = prev

      if (equilibriumManifoldEligibleRealIndexOptions.length > 0) {
        const hasCurrent = equilibriumManifoldEligibleRealIndexSet.has(prev.eigIndex)
        if (!hasCurrent) {
          next = {
            ...next,
            eigIndex: equilibriumManifoldEligibleRealIndexOptions[0].value,
          }
          changed = true
        }
      } else if (prev.eigIndex !== '') {
        next = { ...next, eigIndex: '' }
        changed = true
      }

      let nextEigIndexA = next.eigIndexA
      let nextEigIndexB = next.eigIndexB
      if (equilibriumManifoldEligibleIndexOptions.length > 0) {
        if (!equilibriumManifoldEligibleIndexSet.has(nextEigIndexA)) {
          nextEigIndexA = equilibriumManifoldEligibleIndexOptions[0].value
        }
        if (!equilibriumManifoldEligibleIndexSet.has(nextEigIndexB)) {
          const fallback =
            equilibriumManifoldEligibleIndexOptions[
              Math.min(1, equilibriumManifoldEligibleIndexOptions.length - 1)
            ]
          nextEigIndexB = fallback?.value ?? nextEigIndexA
        }
      } else {
        nextEigIndexA = ''
        nextEigIndexB = ''
      }
      if (nextEigIndexA !== next.eigIndexA || nextEigIndexB !== next.eigIndexB) {
        next = {
          ...next,
          eigIndexA: nextEigIndexA,
          eigIndexB: nextEigIndexB,
        }
        changed = true
      }

      return changed ? next : prev
    })
  }, [
    equilibriumManifoldEligibleIndexOptions,
    equilibriumManifoldEligibleIndexSet,
    equilibriumManifoldEligibleRealIndexOptions,
    equilibriumManifoldEligibleRealIndexSet,
  ])

  useEffect(() => {
    setEquilibriumManifoldDraft((prev) => {
      const resolvedMode =
        equilibriumManifoldModeOptions.length === 1
          ? equilibriumManifoldModeOptions[0].value
          : equilibriumManifoldModeOptionSet.has(prev.mode)
            ? prev.mode
            : equilibriumManifoldModeOptions[0]?.value ?? prev.mode
      if (resolvedMode === prev.mode) {
        return prev
      }
      return {
        ...prev,
        mode: resolvedMode,
      }
    })
  }, [equilibriumManifoldModeOptions, equilibriumManifoldModeOptionSet])

  useEffect(() => {
    if (!limitCycle) return
    setLimitCycleManifoldDraft((prev) => {
      const defaults = makeLimitCycleManifoldDraft(limitCycle)
      return {
        ...defaults,
        ...prev,
        name:
          prev.name.trim().length > 0
            ? prev.name
            : suggestDefaultName('manifold2d', {
                sourceName: limitCycle.name,
                existingNames: existingBranchNames,
              }),
      }
    })
  }, [existingBranchNames, limitCycle])

  useEffect(() => {
    setLimitCycleFloquetModesError(null)
  }, [selectedNodeId, limitCycle?.floquetModes?.computedAt])

  useEffect(() => {
    if (!orbit) return
    setLimitCycleFromOrbitDraft((prev) => {
      const suggestedLimitCycleName = suggestDefaultName('limitCycle', {
        sourceName: orbit.name,
        existingNames: existingObjectNames,
      })
      const limitCycleName =
        prev.limitCycleName.trim().length > 0 ? prev.limitCycleName : suggestedLimitCycleName
      const paramName = continuationParameterSet.has(prev.parameterName)
        ? prev.parameterName
        : firstContinuationParameter
      const suggestedBranchName = suggestDefaultName('continuationBranch', {
        sourceName: limitCycleName,
        parameterName: paramName,
      })
      const branchName =
        prev.branchName.trim().length > 0 ? prev.branchName : suggestedBranchName
      return { ...prev, limitCycleName, branchName, parameterName: paramName }
    })
  }, [
    continuationParameterSet,
    existingObjectNames,
    firstContinuationParameter,
    orbit,
  ])

  useEffect(() => {
    if (!branchName) return
    const fallbackParam =
      continuationParameterLabels.find((name) => name !== branchParameterName) ??
      continuationParameterLabels[0] ??
      ''
    const hopfCodim1Params = resolveCodim1ParamNames(branch)
      const hopfDefaultParam =
        branch?.branchType === 'equilibrium' &&
        continuationParameterSet.has(branch.parameterName)
        ? branch.parameterName
        : branch?.branchType === 'hopf_curve' &&
            hopfCodim1Params &&
            continuationParameterSet.has(hopfCodim1Params.param1)
          ? hopfCodim1Params.param1
          : branch?.branchType === 'hopf_curve' &&
              hopfCodim1Params &&
              continuationParameterSet.has(hopfCodim1Params.param2)
            ? hopfCodim1Params.param2
            : firstContinuationParameter
    setBranchContinuationDraft((prev) => {
      const paramName = continuationParameterSet.has(prev.parameterName)
        ? prev.parameterName
        : fallbackParam
      const suggestedName = suggestDefaultName('branchContinuation', {
        sourceName: branchName,
        parameterName: paramName,
        existingNames: existingBranchNames,
      })
      const nextName = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, parameterName: paramName, name: nextName }
    })
    setFoldCurveDraft((prev) => {
      const param2Name =
        continuationParameterSet.has(prev.param2Name) &&
        prev.param2Name !== branchParameterName
          ? prev.param2Name
          : fallbackParam
      const suggestedName = suggestDefaultName('foldCurve', {
        sourceName: branchName,
        existingNames: existingBranchNames,
      })
      const nextName = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, param2Name, name: nextName }
    })
    setHopfCurveDraft((prev) => {
      const param2Name =
        continuationParameterSet.has(prev.param2Name) &&
        prev.param2Name !== branchParameterName
          ? prev.param2Name
          : fallbackParam
      const suggestedName = suggestDefaultName('hopfCurve', {
        sourceName: branchName,
        existingNames: existingBranchNames,
      })
      const nextName = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, param2Name, name: nextName }
    })
    setIsoperiodicCurveDraft((prev) => {
      const sourceParam1Name =
        branch?.branchType === 'isoperiodic_curve' &&
        hopfCodim1Params &&
        continuationParameterSet.has(hopfCodim1Params.param1)
          ? hopfCodim1Params.param1
          : continuationParameterSet.has(branchParameterName)
            ? branchParameterName
            : firstContinuationParameter
      const parameterName =
        continuationParameterSet.has(prev.parameterName)
          ? prev.parameterName
          : sourceParam1Name
      const fallbackParam2 =
        continuationParameterLabels.find((name) => name !== parameterName) ??
        continuationParameterLabels[0] ??
        ''
      const param2Name =
        continuationParameterSet.has(prev.param2Name) &&
        prev.param2Name !== parameterName
          ? prev.param2Name
          : fallbackParam2
      const suggestedName = suggestDefaultName('isoperiodicCurve', {
        sourceName: branchName,
        existingNames: existingBranchNames,
      })
      const nextName = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, parameterName, param2Name, name: nextName }
    })
    setLimitCycleCodim1CurveDraft((prev) => {
      const sourceCurveParam2 =
        branch &&
        (branch.branchType === 'lpc_curve' ||
          branch.branchType === 'pd_curve' ||
          branch.branchType === 'ns_curve') &&
        hopfCodim1Params &&
        continuationParameterSet.has(hopfCodim1Params.param2)
          ? hopfCodim1Params.param2
          : null
      const param2Name =
        sourceCurveParam2 ??
        (continuationParameterSet.has(prev.param2Name) &&
        prev.param2Name !== branchParameterName
          ? prev.param2Name
          : fallbackParam)
      const target = limitCycleCodim1CurveOptionsForPoint(
        selectedBranchPoint ?? null
      )[0]?.type
      const nameKind =
        target === 'LimitPointCycle'
          ? 'lpcCurve'
          : target === 'PeriodDoubling'
            ? 'pdCurve'
            : 'nsCurve'
      const suggestedName = suggestDefaultName(nameKind, {
        sourceName: branchName,
        existingNames: existingBranchNames,
      })
      const nextName = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, param2Name, name: nextName }
    })
    setNSCurveDraft((prev) => {
      const param2Name =
        continuationParameterSet.has(prev.param2Name) &&
        prev.param2Name !== branchParameterName
          ? prev.param2Name
          : fallbackParam
      const suggestedName = suggestDefaultName('nsCurve', {
        sourceName: branchName,
        existingNames: existingBranchNames,
      })
      const nextName = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, param2Name, name: nextName }
    })
    setLimitCycleFromHopfDraft((prev) => {
      const suggestedLimitCycleName = suggestDefaultName('limitCycle', {
        sourceName: branchName,
        existingNames: existingObjectNames,
      })
      const limitCycleName =
        prev.limitCycleName.trim().length > 0 ? prev.limitCycleName : suggestedLimitCycleName
      const paramName = continuationParameterSet.has(prev.parameterName)
        ? prev.parameterName
        : hopfDefaultParam
      const suggestedBranchName = suggestDefaultName('continuationBranch', {
        sourceName: limitCycleName,
        parameterName: paramName,
      })
      const branchNameValue =
        prev.branchName.trim().length > 0 ? prev.branchName : suggestedBranchName
      return {
        ...prev,
        limitCycleName,
        branchName: branchNameValue,
        parameterName: paramName,
      }
    })
    setHomoclinicFromLargeCycleDraft((prev) => {
      const suggestedName = suggestDefaultName('homoclinic', {
        sourceName: branchName,
        existingNames: existingBranchNames,
      })
      const parameterName = continuationParameterSet.has(prev.parameterName)
        ? prev.parameterName
        : continuationParameterSet.has(branchParameterName)
          ? branchParameterName
          : firstContinuationParameter
      const fallbackParam2 =
        continuationParameterLabels.find((name) => name !== parameterName) ??
        continuationParameterLabels[0] ??
        ''
      const param2Name =
        continuationParameterSet.has(prev.param2Name) && prev.param2Name !== parameterName
          ? prev.param2Name
          : fallbackParam2
      const name = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, name, parameterName, param2Name }
    })
    setHomoclinicFromHomoclinicDraft((prev) => {
      const suggestedName = suggestDefaultName('homoclinicRestart', {
        sourceName: branchName,
        existingNames: existingBranchNames,
      })
      const name = prev.name.trim().length > 0 ? prev.name : suggestedName
      const sourceType = branch?.data.branch_type
      const sourceParam1 =
        sourceType &&
        typeof sourceType === 'object' &&
        'type' in sourceType &&
        sourceType.type === 'HomoclinicCurve' &&
        continuationParameterSet.has(sourceType.param1_name)
          ? sourceType.param1_name
          : firstContinuationParameter
      const parameterName = continuationParameterSet.has(prev.parameterName)
        ? prev.parameterName
        : sourceParam1
      const fallbackParam2 =
        continuationParameterLabels.find((value) => value !== parameterName) ??
        continuationParameterLabels[0] ??
        ''
      const sourceParam2 =
        sourceType &&
        typeof sourceType === 'object' &&
        'type' in sourceType &&
        sourceType.type === 'HomoclinicCurve' &&
        continuationParameterSet.has(sourceType.param2_name) &&
        sourceType.param2_name !== parameterName
          ? sourceType.param2_name
          : fallbackParam2
      const param2Name =
        continuationParameterSet.has(prev.param2Name) && prev.param2Name !== parameterName
          ? prev.param2Name
          : sourceParam2
      const freeTime =
        sourceType &&
        typeof sourceType === 'object' &&
        'type' in sourceType &&
        sourceType.type === 'HomoclinicCurve'
          ? sourceType.free_time
          : prev.freeTime
      const freeEps0 =
        sourceType &&
        typeof sourceType === 'object' &&
        'type' in sourceType &&
        sourceType.type === 'HomoclinicCurve'
          ? sourceType.free_eps0
          : prev.freeEps0
      const freeEps1 =
        sourceType &&
        typeof sourceType === 'object' &&
        'type' in sourceType &&
        sourceType.type === 'HomoclinicCurve'
          ? sourceType.free_eps1
          : prev.freeEps1
      return { ...prev, name, parameterName, param2Name, freeTime, freeEps0, freeEps1 }
    })
    setHomotopySaddleFromEquilibriumDraft((prev) => {
      const suggestedName = suggestDefaultName('homotopySaddle', {
        sourceName: branchName,
        existingNames: existingBranchNames,
      })
      const parameterName = continuationParameterSet.has(prev.parameterName)
        ? prev.parameterName
        : continuationParameterSet.has(branchParameterName)
          ? branchParameterName
          : firstContinuationParameter
      const fallbackParam2 =
        continuationParameterLabels.find((name) => name !== parameterName) ??
        continuationParameterLabels[0] ??
        ''
      const param2Name =
        continuationParameterSet.has(prev.param2Name) && prev.param2Name !== parameterName
          ? prev.param2Name
          : fallbackParam2
      const name = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, name, parameterName, param2Name }
    })
    setHomoclinicFromHomotopySaddleDraft((prev) => {
      const suggestedName = suggestDefaultName('homoclinicStageD', {
        sourceName: branchName,
        existingNames: existingBranchNames,
      })
      const name = prev.name.trim().length > 0 ? prev.name : suggestedName
      return { ...prev, name }
    })
    setBranchExtensionDraft(makeBranchExtensionDraft(stableSystemConfigRef.current, branch))
    setEquilibriumManifoldExtensionDraft(makeEquilibriumManifoldExtensionDraft(branch))
    setBranchContinuationError(null)
    setBranchExtensionError(null)
    setEquilibriumManifoldExtensionError(null)
    setBranchPointError(null)
    setFoldCurveError(null)
    setHopfCurveError(null)
    setLimitCycleCodim1CurveError(null)
    setNSCurveError(null)
    setLimitCycleFromHopfError(null)
    setLimitCycleFromPDError(null)
    setHomoclinicFromLargeCycleError(null)
    setHomoclinicFromHomoclinicError(null)
    setHomotopySaddleFromEquilibriumError(null)
    setHomoclinicFromHomotopySaddleError(null)
  }, [
    branch,
    branchName,
    branchParameterName,
    continuationParameterLabels,
    continuationParameterSet,
    existingBranchNames,
    existingObjectNames,
    firstContinuationParameter,
    selectedBranchPoint,
  ])

  useEffect(() => {
    const branchId = hasBranch ? selectedNodeId : null
    if (!hasBranch) {
      prevBranchIdRef.current = branchId
      prevBranchPointCountRef.current = 0
      prevBranchMinLogicalIndexRef.current = null
      prevBranchMaxLogicalIndexRef.current = null
      setBranchPointIndex(null)
      setBranchPointInput('')
      syncBranchPointSelection(null)
      return
    }
    if (branchSortedOrder.length === 0) {
      prevBranchIdRef.current = branchId
      prevBranchPointCountRef.current = 0
      prevBranchMinLogicalIndexRef.current = null
      prevBranchMaxLogicalIndexRef.current = null
      setBranchPointIndex(null)
      setBranchPointInput('')
      syncBranchPointSelection(null)
      return
    }
    const minLogicalArrayIndex = branchSortedOrder[0]
    const maxLogicalArrayIndex = branchSortedOrder[branchSortedOrder.length - 1]
    const minLogicalIndex = branchIndices[minLogicalArrayIndex]
    const maxLogicalIndex = branchIndices[maxLogicalArrayIndex]
    const hasNegativeLogicalSide =
      typeof minLogicalIndex === 'number' && Number.isFinite(minLogicalIndex) && minLogicalIndex < 0
    const hasPositiveLogicalSide =
      typeof maxLogicalIndex === 'number' && Number.isFinite(maxLogicalIndex) && maxLogicalIndex > 0
    const useEndpointDefaultForSelection = branch?.branchType !== 'limit_cycle'
    const endpointDefaultArrayIndex =
      useEndpointDefaultForSelection
        ? hasNegativeLogicalSide && !hasPositiveLogicalSide
          ? minLogicalArrayIndex
          : hasPositiveLogicalSide && !hasNegativeLogicalSide
            ? maxLogicalArrayIndex
            : maxLogicalArrayIndex
        : branchSortedOrder[0]

    const pointCount = branchIndices.length
    const branchChanged = prevBranchIdRef.current !== branchId
    const pointsExtended = !branchChanged && pointCount > prevBranchPointCountRef.current
    if (pointsExtended) {
      const previousMinLogical = prevBranchMinLogicalIndexRef.current
      const previousMaxLogical = prevBranchMaxLogicalIndexRef.current
      let newestIndex = endpointDefaultArrayIndex
      if (
        typeof previousMinLogical === 'number' &&
        Number.isFinite(previousMinLogical) &&
        typeof minLogicalIndex === 'number' &&
        Number.isFinite(minLogicalIndex) &&
        minLogicalIndex < previousMinLogical
      ) {
        newestIndex = minLogicalArrayIndex
      } else if (
        typeof previousMaxLogical === 'number' &&
        Number.isFinite(previousMaxLogical) &&
        typeof maxLogicalIndex === 'number' &&
        Number.isFinite(maxLogicalIndex) &&
        maxLogicalIndex > previousMaxLogical
      ) {
        newestIndex = maxLogicalArrayIndex
      }
      setBranchPointIndex(newestIndex)
      const logicalIndex = branchIndices[newestIndex]
      setBranchPointInput(
        typeof logicalIndex === 'number' ? logicalIndex.toString() : ''
      )
      setBranchPointError(null)
      syncBranchPointSelection(newestIndex)
      prevBranchIdRef.current = branchId
      prevBranchPointCountRef.current = pointCount
      prevBranchMinLogicalIndexRef.current =
        typeof minLogicalIndex === 'number' && Number.isFinite(minLogicalIndex)
          ? minLogicalIndex
          : null
      prevBranchMaxLogicalIndexRef.current =
        typeof maxLogicalIndex === 'number' && Number.isFinite(maxLogicalIndex)
          ? maxLogicalIndex
          : null
      return
    }
    const hasValidIndex =
      branchPointIndex !== null &&
      branchPointIndex >= 0 &&
      branchPointIndex < branchIndices.length
    if (!branchChanged && hasValidIndex) {
      prevBranchIdRef.current = branchId
      prevBranchPointCountRef.current = pointCount
      prevBranchMinLogicalIndexRef.current =
        typeof minLogicalIndex === 'number' && Number.isFinite(minLogicalIndex)
          ? minLogicalIndex
          : null
      prevBranchMaxLogicalIndexRef.current =
        typeof maxLogicalIndex === 'number' && Number.isFinite(maxLogicalIndex)
          ? maxLogicalIndex
          : null
      return
    }
    const renderTargetIndex =
      branchRenderTarget?.type === 'branch' && branchRenderTarget.branchId === branchId
        ? branchRenderTarget.pointIndex
        : null
    const renderTargetValid =
      renderTargetIndex !== null &&
      renderTargetIndex >= 0 &&
      renderTargetIndex < branchIndices.length
    const initialIndex = renderTargetValid
      ? renderTargetIndex
      : endpointDefaultArrayIndex
    setBranchPointIndex(initialIndex)
    const logicalIndex = branchIndices[initialIndex]
    setBranchPointInput(
      typeof logicalIndex === 'number' ? logicalIndex.toString() : ''
    )
    setBranchPointError(null)
    syncBranchPointSelection(initialIndex)
    prevBranchIdRef.current = branchId
    prevBranchPointCountRef.current = pointCount
    prevBranchMinLogicalIndexRef.current =
      typeof minLogicalIndex === 'number' && Number.isFinite(minLogicalIndex)
        ? minLogicalIndex
        : null
    prevBranchMaxLogicalIndexRef.current =
      typeof maxLogicalIndex === 'number' && Number.isFinite(maxLogicalIndex)
        ? maxLogicalIndex
        : null
  }, [
    branchIndices,
    branchPointIndex,
    branchRenderTarget,
    branch?.branchType,
    branchSortedOrder,
    hasBranch,
    selectedNodeId,
    syncBranchPointSelection,
  ])

  useEffect(() => {
    branchPointIndexRef.current = branchPointIndex
  }, [branchPointIndex])

  useEffect(() => {
    setBranchNavigatorOpen(false)
  }, [selectionKey])

  const systemConfig = useMemo(() => buildSystemConfig(systemDraft), [systemDraft])
  const systemValidation = useMemo(() => validateSystemConfig(systemConfig), [systemConfig])
  const runDisabled = !systemValidation.valid
  const isDiscreteMap = systemDraft.type === 'map'
  const equilibriumSnapshot = useMemo(() => {
    if (!equilibrium) return null
    if (
      equilibrium.subsystemSnapshot &&
      isSubsystemSnapshotCompatible(system.config, equilibrium.subsystemSnapshot)
    ) {
      return equilibrium.subsystemSnapshot
    }
    return buildSubsystemSnapshot(
      system.config,
      { frozenValuesByVarName: resolveObjectFrozenValues(system.config, equilibrium) }
    )
  }, [equilibrium, system.config])
  const branchSnapshot = useMemo(() => {
    if (!branch?.subsystemSnapshot) return null
    if (!isSubsystemSnapshotCompatible(system.config, branch.subsystemSnapshot)) return null
    return branch.subsystemSnapshot
  }, [branch?.subsystemSnapshot, system.config])
  const branchStateDimension = branchSnapshot?.freeVariableNames.length ?? systemDraft.varNames.length
  const selectedBranchPointDisplayProjection = useMemo(() => {
    if (!branch || !selectedBranchPoint) return undefined
    const projection: {
      parameterRef?: ContinuationObject['parameterRef']
      paramValue?: number
      parameter2Ref?: ContinuationObject['parameter2Ref']
      param2Value?: number
    } = {}
    if (branch.parameterRef?.kind === 'frozen_var' && Number.isFinite(selectedBranchPoint.param_value)) {
      projection.parameterRef = branch.parameterRef
      projection.paramValue = selectedBranchPoint.param_value
    }
    const branchType = branch.data.branch_type
    const branchParam2Ref =
      branchType &&
      typeof branchType === 'object' &&
      'param2_ref' in branchType &&
      branchType.param2_ref
        ? branchType.param2_ref
        : branch.parameter2Ref
    if (branchParam2Ref?.kind === 'frozen_var') {
      const param2Value = Number.isFinite(selectedBranchPoint.param2_value)
        ? selectedBranchPoint.param2_value
        : resolveContinuationPointParam2Value(
            selectedBranchPoint,
            branchType,
            branchStateDimension
          )
      if (Number.isFinite(param2Value)) {
        projection.parameter2Ref = branchParam2Ref
        projection.param2Value = param2Value as number
      }
    }
    return Object.keys(projection).length > 0 ? projection : undefined
  }, [branch, branchStateDimension, selectedBranchPoint])
  const equilibriumDisplayState = useMemo(() => {
    if (!equilibrium?.solution?.state) return null
    if (!equilibriumSnapshot) return equilibrium.solution.state
    return stateVectorToDisplay(equilibriumSnapshot, equilibrium.solution.state)
  }, [equilibrium?.solution?.state, equilibriumSnapshot])
  const equilibriumCyclePoints =
    isDiscreteMap && equilibrium?.solution?.state
      ? equilibrium.solution.cycle_points && equilibrium.solution.cycle_points.length > 0
        ? equilibrium.solution.cycle_points.map((point) =>
            equilibriumSnapshot ? stateVectorToDisplay(equilibriumSnapshot, point) : point
          )
        : [
            equilibriumSnapshot
              ? stateVectorToDisplay(equilibriumSnapshot, equilibrium.solution.state)
              : equilibrium.solution.state,
          ]
      : null
  const branchCyclePoints =
    isDiscreteMap && branch?.branchType === 'equilibrium' && selectedBranchPoint?.state
      ? selectedBranchPoint.cycle_points && selectedBranchPoint.cycle_points.length > 0
        ? selectedBranchPoint.cycle_points.map((point) =>
            branchSnapshot
              ? stateVectorToDisplay(branchSnapshot, point, selectedBranchPointDisplayProjection)
              : point
          )
        : [
            branchSnapshot
              ? stateVectorToDisplay(
                  branchSnapshot,
                  selectedBranchPoint.state,
                  selectedBranchPointDisplayProjection
                )
              : selectedBranchPoint.state,
          ]
      : null
  const plotlyTheme = useMemo(() => resolvePlotlyThemeTokens(theme), [theme])
  const equilibriumEigenPlot = useMemo(() => {
    const eigenpairs = equilibrium?.solution?.eigenpairs
    if (!eigenpairs || eigenpairs.length === 0) return null
    return buildEigenvaluePlot(eigenpairs.map((pair) => pair.value), plotlyTheme, {
      showRadiusLines: isDiscreteMap,
      showUnitDisc: isDiscreteMap,
      markerColors: equilibriumEigenvalueMarkerColors,
    })
  }, [
    equilibrium?.solution?.eigenpairs,
    equilibriumEigenvalueMarkerColors,
    isDiscreteMap,
    plotlyTheme,
  ])
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
          label: equilibriumLabel,
          detail: object.solution ? 'Solved' : 'Not solved',
        }
      }
      if (object.type === 'limit_cycle') {
        return {
          label: 'Limit Cycle',
          detail: `Period ${object.period}`,
        }
      }
      if (object.type === 'isocline') {
        return {
          label: 'Isocline',
          detail: object.lastComputed ? `Computed ${object.lastComputed.computedAt}` : 'Not computed',
        }
      }
      return null
    }

    if (branch) {
      return {
        label: 'Branch',
        detail: `${formatBranchType(branch, systemDraft.type)} · ${branch.data.points.length} points`,
      }
    }

    if (scene) {
      return {
        label: 'Scene',
        detail:
          scene.display === 'selection'
            ? 'Selection focus'
            : 'All visible objects and branches',
      }
    }

    if (diagram) {
      const branchCount = diagram.selectedBranchIds.length
      const detail =
        branchCount > 0
          ? `${branchCount} branch${branchCount === 1 ? '' : 'es'} enabled`
          : branchEntries.length > 0
            ? 'All visible branches'
            : 'No branches available'
      return {
        label: 'Bifurcation',
        detail,
      }
    }

    return null
  }, [branch, branchEntries.length, diagram, equilibriumLabel, object, scene, systemDraft.type])

  const hasParamOverride = Array.isArray(paramOverrideTarget?.customParameters)
  const hasCustomParamOverride = hasCustomObjectParams(
    system.config,
    paramOverrideTarget?.customParameters
  )
  const paramOverrideTitle = hasCustomParamOverride ? (
    <>
      <span>Parameters</span>
      <span className="tree-node__tag">custom</span>
    </>
  ) : (
    'Parameters'
  )

  const limitCycleFromOrbitNameSuggestion = useMemo(() => {
    return suggestDefaultName('limitCycle', {
      sourceName: orbit?.name ?? 'orbit',
      existingNames: existingObjectNames,
    })
  }, [existingObjectNames, orbit?.name])

  const limitCycleFromOrbitBranchSuggestion = useMemo(() => {
    const baseName =
      limitCycleFromOrbitDraft.limitCycleName.trim() || limitCycleFromOrbitNameSuggestion
    const paramName = limitCycleFromOrbitDraft.parameterName
    return suggestDefaultName('continuationBranch', {
      sourceName: baseName,
      parameterName: paramName,
    })
  }, [
    limitCycleFromOrbitDraft.limitCycleName,
    limitCycleFromOrbitDraft.parameterName,
    limitCycleFromOrbitNameSuggestion,
  ])

  const limitCycleFromHopfBranchSuggestion = useMemo(() => {
    if (!branch) return ''
    const baseName =
      limitCycleFromHopfDraft.limitCycleName.trim() ||
      suggestDefaultName('limitCycle', {
        sourceName: branch.name,
        existingNames: existingObjectNames,
      })
    const paramName = limitCycleFromHopfDraft.parameterName
    return suggestDefaultName('continuationBranch', {
      sourceName: baseName,
      parameterName: paramName,
    })
  }, [
    branch,
    existingObjectNames,
    limitCycleFromHopfDraft.limitCycleName,
    limitCycleFromHopfDraft.parameterName,
  ])

  const sceneSelectedIds = useMemo(
    () => scene?.selectedNodeIds ?? [],
    [scene?.selectedNodeIds]
  )
  const sceneSelectedSet = useMemo(() => new Set(sceneSelectedIds), [sceneSelectedIds])
  const sceneSelectableEntries = useMemo<SceneSelectableEntry[]>(() => {
    const objects = objectEntries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      type: entry.type.replace('_', ' '),
      visible: entry.visible,
    }))
    const branches = branchEntries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      type: entry.type,
      visible: entry.visible,
    }))
    return [...objects, ...branches].sort((a, b) => a.name.localeCompare(b.name))
  }, [branchEntries, objectEntries])
  const sceneFilteredEntries = useMemo(() => {
    const query = sceneSearch.trim().toLowerCase()
    if (!query) return sceneSelectableEntries
    return sceneSelectableEntries.filter((entry) => {
      const name = entry.name.toLowerCase()
      const type = entry.type.toLowerCase()
      return name.includes(query) || type.includes(query)
    })
  }, [sceneSearch, sceneSelectableEntries])
  const sceneSelectedEntries = useMemo(() => {
    if (!scene) return []
    const byId = new Map(sceneSelectableEntries.map((entry) => [entry.id, entry]))
    return sceneSelectedIds
      .map((id) => byId.get(id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  }, [sceneSelectableEntries, scene, sceneSelectedIds])
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
  const codim1ParamNames = useMemo(() => resolveCodim1ParamNames(branch), [branch])
  const branchBifurcations = useMemo(
    () => (branch ? branch.data.bifurcations ?? [] : []),
    [branch]
  )
  const isoperiodicSourceParam1Name = useMemo(() => {
    if (branch?.branchType !== 'isoperiodic_curve') {
      return branchParameterName
    }
    return codim1ParamNames?.param1 ?? ''
  }, [branch?.branchType, branchParameterName, codim1ParamNames])
  const codim1ParamOptions = useMemo(() => {
    const sourceParam1Name =
      branch?.branchType === 'isoperiodic_curve'
        ? isoperiodicSourceParam1Name
        : branchParameterName
    return continuationParameterLabels.filter((name) => name !== sourceParam1Name)
  }, [
    branch?.branchType,
    branchParameterName,
    continuationParameterLabels,
    isoperiodicSourceParam1Name,
  ])
  const isoperiodicParam1Options = continuationParameterLabels
  const isoperiodicParam2Options = useMemo(
    () =>
      continuationParameterLabels.filter((name) => name !== isoperiodicCurveDraft.parameterName),
    [continuationParameterLabels, isoperiodicCurveDraft.parameterName]
  )
  const branchStartIndex = branchSortedOrder[0]
  const branchEndIndex = branchSortedOrder[branchSortedOrder.length - 1]
  const branchStartPoint = branchStartIndex !== undefined ? branch?.data.points[branchStartIndex] : null
  const branchEndPoint = branchEndIndex !== undefined ? branch?.data.points[branchEndIndex] : null
  const hopfOmega = selectedBranchPoint ? extractHopfOmega(selectedBranchPoint) : null
  const hopfCurveLabel = 'Hopf'
  const nsCurveLabel = 'Neimark-Sacker'
  const pdObjectLabel = isDiscreteMap ? 'Cycle' : 'Limit Cycle'
  const pdObjectLabelName = isDiscreteMap ? 'Cycle' : 'Limit cycle'
  const hasSelectedBranchPoint = Boolean(selectedBranchPoint)
  const isFoldPointSelected = selectedBranchPoint?.stability === 'Fold'
  const isHopfCurvePointSelected = selectedBranchPoint?.stability === 'Hopf'
  const isNSCurvePointSelected = selectedBranchPoint?.stability === 'NeimarkSacker'
  const isHopfSourceBranch =
    branch?.branchType === 'equilibrium' || branch?.branchType === 'hopf_curve'
  const isHopfPointSelected =
    hasSelectedBranchPoint &&
    (branch?.branchType === 'equilibrium'
      ? selectedBranchPoint?.stability === 'Hopf'
      : true)
  const isPeriodDoublingPointSelected =
    selectedBranchPoint?.stability === 'PeriodDoubling'
  const showLimitCycleFromHopf =
    !isDiscreteMap &&
    isHopfSourceBranch &&
    isHopfPointSelected
  const showLimitCycleFromPD = isPeriodDoublingPointSelected
  const branchSupportsContinueFromPoint =
    branch?.branchType === 'equilibrium' ||
    (systemDraft.type === 'flow' && branch?.branchType === 'limit_cycle')
  const showBranchContinueFromPoint =
    branchSupportsContinueFromPoint && hasSelectedBranchPoint
  const showCodim1CurveContinuations =
    branch?.branchType === 'equilibrium' &&
    hasSelectedBranchPoint &&
    (isFoldPointSelected || isHopfCurvePointSelected || isNSCurvePointSelected)
  const showFoldCurveContinuation =
    showCodim1CurveContinuations && isFoldPointSelected
  const showHopfCurveContinuation =
    showCodim1CurveContinuations && !isDiscreteMap && isHopfCurvePointSelected
  const showNSCurveContinuation =
    showCodim1CurveContinuations && isDiscreteMap && isNSCurvePointSelected
  const limitCycleCodim1CurveOptions = useMemo(
    () =>
      !isDiscreteMap &&
      branch &&
      (branch.branchType === 'limit_cycle' ||
        branch.branchType === 'lpc_curve' ||
        branch.branchType === 'pd_curve' ||
        branch.branchType === 'ns_curve')
        ? limitCycleCodim1CurveOptionsForPoint(selectedBranchPoint ?? null)
        : [],
    [branch, isDiscreteMap, selectedBranchPoint]
  )
  const limitCycleCodim1Curve =
    limitCycleCodim1CurveOptions.find(
      (option) => option.type === limitCycleCodim1CurveTarget
    ) ?? limitCycleCodim1CurveOptions[0] ?? null
  useEffect(() => {
    setLimitCycleCodim1CurveTarget((current) =>
      current && limitCycleCodim1CurveOptions.some((option) => option.type === current)
        ? current
        : limitCycleCodim1CurveOptions[0]?.type ?? null
    )
  }, [branchPointIndex, limitCycleCodim1CurveOptions, selectionKey])
  const showLimitCycleCodim1CurveContinuation = Boolean(limitCycleCodim1Curve)
  const showIsoperiodicContinuation =
    (branch?.branchType === 'limit_cycle' || branch?.branchType === 'isoperiodic_curve') &&
    hasSelectedBranchPoint
  const homotopyBranchStage =
    branch?.data.branch_type &&
    typeof branch.data.branch_type === 'object' &&
    'type' in branch.data.branch_type &&
    branch.data.branch_type.type === 'HomotopySaddleCurve'
      ? branch.data.branch_type.stage
      : null
  const showHomoclinicFromLargeCycle =
    branch?.branchType === 'limit_cycle' && hasSelectedBranchPoint
  const showHomoclinicFromHomoclinic =
    branch?.branchType === 'homoclinic_curve' && hasSelectedBranchPoint
  const showHomotopySaddleFromEquilibrium =
    branch?.branchType === 'equilibrium' && hasSelectedBranchPoint
  const showHomoclinicFromHomotopySaddle =
    branch?.branchType === 'homotopy_saddle_curve' && hasSelectedBranchPoint
  const homotopyStageDReady = homotopyBranchStage === 'StageD'
  const branchEigenvalues = useMemo(
    () =>
      selectedBranchPoint
        ? normalizeEigenvalueArray(selectedBranchPoint.eigenvalues)
        : [],
    [selectedBranchPoint]
  )
  const branchEigenPlot = useMemo(() => {
    if (isLimitCycleBranch) return null
    if (branchEigenvalues.length === 0) return null
    return buildEigenvaluePlot(branchEigenvalues, plotlyTheme, {
      showRadiusLines: isDiscreteMap,
      showUnitDisc: isDiscreteMap,
    })
  }, [branchEigenvalues, isDiscreteMap, isLimitCycleBranch, plotlyTheme])
  const branchMultiplierPlot = useMemo(() => {
    if (!isLimitCycleBranch) return null
    if (branchEigenvalues.length === 0) return null
    return buildEigenvaluePlot(branchEigenvalues, plotlyTheme, {
      showUnitCircle: true,
    })
  }, [branchEigenvalues, isLimitCycleBranch, plotlyTheme])
  const selectedBranchPointParams = useMemo(() => {
    if (!branch || !selectedBranchPoint) return []
    return resolveBranchPointParams(
      systemDraft.paramNames,
      branchParams,
      branch,
      selectedBranchPoint,
      branchStateDimension
    )
  }, [
    branch,
    branchStateDimension,
    branchParams,
    selectedBranchPoint,
    systemDraft.paramNames,
  ])
  const selectedBranchPointParameterReadout = useMemo(() => {
    if (!branch || !selectedBranchPoint) return null
    return resolveContinuationParameterReadout(
      systemDraft,
      branchParams,
      branch,
      selectedBranchPoint,
      branchStateDimension
    )
  }, [branch, branchParams, branchStateDimension, selectedBranchPoint, systemDraft])
  const selectedBranchPointState = useMemo(() => {
    if (!branch || !selectedBranchPoint) return []
    if (branch.branchType === 'limit_cycle' || branch.branchType === 'isoperiodic_curve') {
      const { profilePoints } = extractLimitCycleProfile(
        selectedBranchPoint.state,
        branchStateDimension,
        limitCycleMesh.ntst,
        limitCycleMesh.ncol,
        { layout: branch.branchType === 'isoperiodic_curve' ? 'stage-first' : 'mesh-first' }
      )
      const representativeState = profilePoints[0] ?? selectedBranchPoint.state
      if (!branchSnapshot) return representativeState
      return stateVectorToDisplay(
        branchSnapshot,
        representativeState,
        selectedBranchPointDisplayProjection
      )
    }
    const equilibriumState = resolveContinuationPointEquilibriumState(
      selectedBranchPoint,
      branch.data.branch_type,
      branchStateDimension
    )
    const state =
      equilibriumState && equilibriumState.length > 0
        ? equilibriumState
        : selectedBranchPoint.state
    if (!branchSnapshot) return state
    return stateVectorToDisplay(branchSnapshot, state, selectedBranchPointDisplayProjection)
  }, [
    branch,
    limitCycleMesh.ncol,
    limitCycleMesh.ntst,
    branchSnapshot,
    branchStateDimension,
    selectedBranchPoint,
    selectedBranchPointDisplayProjection,
  ])
  const limitCycleRenderData = useMemo(() => {
    if (!limitCycleRenderPoint || !limitCycleRenderBranch) return null
    const baseParams = getBranchParams(system, limitCycleRenderBranch)
    const params = resolveBranchPointParams(
      systemDraft.paramNames,
      baseParams,
      limitCycleRenderBranch,
      limitCycleRenderPoint,
      systemDraft.varNames.length
    )
    const multipliers = normalizeEigenvalueArray(limitCycleRenderPoint.eigenvalues)
    const parameterName =
      limitCycle?.parameterName || limitCycleRenderBranch.parameterName
    const paramIndex = parameterName
      ? systemDraft.paramNames.indexOf(parameterName)
      : -1
    const paramValue =
      paramIndex >= 0 ? params[paramIndex] : limitCycleRenderPoint.param_value
    return { params, multipliers, paramValue }
  }, [
    limitCycle?.parameterName,
    limitCycleRenderBranch,
    limitCycleRenderPoint,
    system,
    systemDraft.paramNames,
    systemDraft.varNames.length,
  ])
  const limitCycleDisplayParams =
    limitCycleRenderData?.params ?? limitCycle?.parameters ?? []
  const limitCycleDisplayParamValue =
    limitCycleRenderData?.paramValue ?? limitCycle?.paramValue
  const limitCycleDisplayMultipliers = useMemo(() => {
    if (limitCycleRenderData?.multipliers) {
      return limitCycleRenderData.multipliers
    }
    return limitCycle?.floquetMultipliers ?? []
  }, [limitCycle?.floquetMultipliers, limitCycleRenderData])
  const limitCycleFloquetModes = limitCycle?.floquetModes ?? null
  const limitCycleModeMultipliers =
    limitCycleFloquetModes?.multipliers ?? limitCycleDisplayMultipliers
  const limitCycleRenderableMultipliers = useMemo(
    () => normalizeFloquetMultipliersForRendering(limitCycleModeMultipliers),
    [limitCycleModeMultipliers]
  )
  const limitCycleFloquetPairTemplate = useMemo(
    () =>
      limitCycleRenderableMultipliers.map((value) => ({
        value,
        vector: [] as ComplexValue[],
      })),
    [limitCycleRenderableMultipliers]
  )
  const limitCycleFloquetEigenspaceIndices = resolveEquilibriumEigenspaceIndices(
    limitCycleFloquetPairTemplate
  )
  const limitCycleFloquetRender = resolveEquilibriumEigenvectorRender(
    selectionNode?.render?.equilibriumEigenvectors,
    limitCycleFloquetEigenspaceIndices
  )
  const limitCycleFloquetIndices = defaultEquilibriumEigenvectorIndices(
    limitCycleFloquetEigenspaceIndices
  )
  const limitCycleFloquetColors = resolveEquilibriumEigenvectorColors(
    limitCycleFloquetIndices,
    limitCycleFloquetRender.vectorIndices,
    limitCycleFloquetRender.colors,
    limitCycleFloquetRender.colorOverrides
  )
  const limitCycleFloquetVisibleSet = new Set(limitCycleFloquetRender.vectorIndices)
  const limitCycleFloquetMarkerColors = resolveEquilibriumEigenvalueMarkerColors(
    limitCycleFloquetPairTemplate,
    limitCycleFloquetIndices,
    limitCycleFloquetColors
  )
  const limitCycleManifoldEligibleFloquetIndexOptions = useMemo(
    () =>
      limitCycleDisplayMultipliers
        .map((value, index) => ({ value, index }))
        .filter(({ value }) =>
          cycleManifoldFloquetEligibility(value, limitCycleManifoldDraft.stability).eligible
        )
        .map(({ value, index }) => ({
          value: index.toString(),
          label: `${index + 1} (${formatComplexValue(value)})`,
        })),
    [limitCycleDisplayMultipliers, limitCycleManifoldDraft.stability]
  )
  const limitCycleManifoldEligibleFloquetIndexSet = useMemo(
    () => new Set(limitCycleManifoldEligibleFloquetIndexOptions.map((option) => option.value)),
    [limitCycleManifoldEligibleFloquetIndexOptions]
  )
  useEffect(() => {
    setLimitCycleManifoldDraft((prev) => {
      if (limitCycleManifoldEligibleFloquetIndexOptions.length === 0) {
        return prev.floquetIndex === '' ? prev : { ...prev, floquetIndex: '' }
      }
      if (limitCycleManifoldEligibleFloquetIndexSet.has(prev.floquetIndex)) {
        return prev
      }
      return {
        ...prev,
        floquetIndex: limitCycleManifoldEligibleFloquetIndexOptions[0]?.value ?? '',
      }
    })
  }, [
    limitCycleManifoldEligibleFloquetIndexOptions,
    limitCycleManifoldEligibleFloquetIndexSet,
  ])
  const limitCycleMultiplierPlot = useMemo(() => {
    if (limitCycleModeMultipliers.length === 0) return null
    return buildEigenvaluePlot(limitCycleModeMultipliers, plotlyTheme, {
      showUnitCircle: true,
      markerColors: limitCycleFloquetMarkerColors,
    })
  }, [limitCycleModeMultipliers, limitCycleFloquetMarkerColors, plotlyTheme])
  const limitCycleFloquetModesMatchMesh =
    limitCycleFloquetModes !== null &&
    limitCycle !== null &&
    limitCycleFloquetModes.ntst === limitCycle.ntst &&
    limitCycleFloquetModes.ncol === limitCycle.ncol
  const limitCycleFloquetModePointCount = limitCycleFloquetModes?.vectors.length ?? 0
  const limitCycleFloquetModeCount = limitCycleFloquetModes?.multipliers.length ?? 0
  const limitCycleFloquetModesAvailable =
    limitCycleFloquetModesMatchMesh &&
    limitCycleFloquetModePointCount > 0 &&
    limitCycleFloquetModeCount > 0

  const branchNormalFormProvenance = branch?.data.normal_form_provenance
  const branchNormalFormIsChildProvenance = Boolean(
    branchNormalFormProvenance &&
      ![
        branchNormalFormProvenance.source_branch_id,
        branchNormalFormProvenance.source_branch_name,
        branchNormalFormProvenance.source_branch,
      ].some(
        (sourceBranch) =>
          sourceBranch === selectedNodeId || sourceBranch === branch?.name
      )
  )
  const showNormalFormWorkflow = Boolean(
    branch &&
      selectedBranchPoint &&
      (supportsNormalFormWorkflow(
        systemDraft.type,
        branch.branchType,
        selectedBranchPoint.stability,
        selectedBranchPoint.codim2?.type
      ) ||
        selectedBranchPoint.normal_form ||
        branchNormalFormIsChildProvenance)
  )

  const workflowActions: WorkflowActionEntry[] = []
  if (
    showVisibilityToggle ||
    selectionNode?.kind === 'object' ||
    selectionNode?.kind === 'branch'
  ) {
    workflowActions.push({
      id: 'appearance-toggle',
      group: 'Configure',
      label: 'Appearance',
      description: 'Change visibility, color, line, and point styling.',
    })
  }
  if (paramOverrideTarget && !isocline) {
    workflowActions.push(
      {
        id: 'frozen-variables-toggle',
        group: 'Configure',
        label: 'Frozen Variables',
        description: 'Choose variables to hold constant for this object.',
        tag: subsystemSnapshotMismatch ? 'mismatch' : undefined,
      },
      {
        id: 'parameters-toggle',
        group: 'Configure',
        label: 'Parameters',
        description: 'Override the system parameter values for this object.',
        tag: hasCustomParamOverride ? 'custom' : undefined,
      }
    )
  }
  if (orbit) {
    if (orbit.data.length > 0) {
      workflowActions.push({
        id: 'orbit-data-toggle',
        group: 'Inspect',
        label: 'View Data',
        description: 'Inspect stored orbit samples, parameters, and run metadata.',
      })
    }
    workflowActions.push({
      id: 'orbit-run-toggle',
      group: 'Compute',
      label: 'Run orbit',
      description: 'Integrate or iterate this orbit from a chosen initial state.',
    })
    if (orbit.data.length >= 2) {
      workflowActions.push({
        id: 'oseledets-toggle',
        group: 'Compute',
        label: 'Lyapunov analysis',
        description: 'Compute exponents and covariant Lyapunov vectors.',
      })
    }
    if (!isDiscreteMap && orbit.data.length > 0) {
      workflowActions.push({
        id: 'limit-cycle-toggle',
        group: 'Continuation',
        label: 'Limit cycle from orbit',
        description: 'Initialize and continue a periodic orbit from this trajectory.',
      })
    }
  }
  if (equilibrium) {
    if (equilibrium.solution) {
      workflowActions.push({
        id: 'equilibrium-data-toggle',
        group: 'Inspect',
        label: 'View Data',
        description: `Inspect the stored ${equilibriumLabelLower} solution and spectrum.`,
      })
    }
    workflowActions.push({
      id: 'equilibrium-solver-toggle',
      group: 'Compute',
      label: `Solve ${equilibriumLabel}`,
      description: 'Refine the state and compute its local spectrum.',
    })
    if (equilibrium.solution) {
      workflowActions.push(
        {
          id: 'equilibrium-continuation-toggle',
          group: 'Continuation',
          label: `Continue ${equilibriumLabel}`,
          description: 'Create a one-parameter continuation branch.',
        },
        {
          id: 'equilibrium-manifold-toggle',
          group: 'Manifolds',
          label: 'Invariant manifold',
          description: 'Seed a 1D curve or 2D surface from the eigenspaces.',
        }
      )
    }
  }
  if (limitCycle) {
    workflowActions.push({
      id: 'limit-cycle-data-toggle',
      group: 'Inspect',
      label: 'View Data',
      description: 'Inspect the cycle profile, parameters, and Floquet data.',
    })
    if (limitCycleDisplayMultipliers.length > 0) {
      workflowActions.push({
        id: 'limit-cycle-manifold-toggle',
        group: 'Manifolds',
        label: 'Limit-cycle manifold',
        description: 'Create a 2D invariant manifold from a Floquet eigenspace.',
      })
    }
  }
  if (isocline) {
    workflowActions.push({
      id: 'isocline-toggle',
      group: 'Compute',
      label: 'Configure and compute isocline',
      description: 'Choose active axes, frozen values, and recompute the geometry.',
    })
  }
  if (branch) {
    workflowActions.push(
      {
        id: 'branch-summary-toggle',
        group: 'Inspect',
        label: 'View Summary',
        description: 'Inspect branch metadata, settings, and solver diagnostics.',
      },
      {
        id: 'branch-points-toggle',
        group: 'Inspect',
        label: 'View Data',
        description: 'Navigate branch points and inspect the selected point.',
      }
    )
  }
  if (showNormalFormWorkflow) {
    workflowActions.push({
      id: 'normal-form-workflow-toggle',
      group: 'Bifurcations',
      label: 'Normal form & branch switching',
      description: 'Compute local coefficients and continue an eligible outgoing branch.',
    })
  }
  if (canExtendInvariantManifold) {
    workflowActions.push({
      id: 'manifold-extend-toggle',
      group: 'Manifolds',
      label: 'Extend invariant manifold',
      description: 'Continue the selected manifold beyond its current endpoint.',
    })
  }
  if (canExtendBranch) {
    workflowActions.push({
      id: 'branch-extend-toggle',
      group: 'Continuation',
      label: 'Extend branch',
      description: 'Continue the selected branch from an existing endpoint.',
    })
  }
  if (showBranchContinueFromPoint) {
    workflowActions.push({
      id: 'branch-continue-toggle',
      group: 'Continuation',
      label: 'Continue from point',
      description: 'Start another continuation branch from the selected point.',
    })
  }
  if (showCodim1CurveContinuations) {
    workflowActions.push({
      id: 'codim1-curve-toggle',
      group: 'Bifurcations',
      label: 'Codimension-1 curve',
      description: 'Continue an eligible fold, Hopf, or Neimark-Sacker point.',
    })
  }
  if (showLimitCycleCodim1CurveContinuation && limitCycleCodim1Curve) {
    workflowActions.push({
      id: 'limit-cycle-codim1-curve-toggle',
      group: 'Bifurcations',
      label: `${limitCycleCodim1Curve.label} curve`,
      description: `Continue the selected cycle bifurcation as a two-parameter ${limitCycleCodim1Curve.label} curve.`,
    })
  }
  if (showIsoperiodicContinuation) {
    workflowActions.push({
      id: 'isoperiodic-curve-toggle',
      group: 'Continuation',
      label:
        branch?.branchType === 'isoperiodic_curve'
          ? 'Continue isoperiodic curve'
          : 'Create isoperiodic curve',
      description: 'Continue an isoperiodic curve from the selected cycle point.',
    })
  }
  if (showLimitCycleFromHopf) {
    workflowActions.push({
      id: 'limit-cycle-from-hopf-toggle',
      group: 'Bifurcations',
      label: 'Limit cycle from Hopf',
      description: 'Initialize a periodic orbit and its continuation branch.',
    })
  }
  if (showLimitCycleFromPD) {
    workflowActions.push({
      id: 'limit-cycle-from-pd-toggle',
      group: 'Bifurcations',
      label: `${limitCycleFromPDLabel} from period doubling`,
      description: 'Initialize the doubled cycle and continue it.',
    })
  }
  if (showHomoclinicFromLargeCycle) {
    workflowActions.push({
      id: 'homoclinic-from-large-cycle-toggle',
      group: 'Bifurcations',
      label: 'Homoclinic from large cycle',
      description: 'Initialize a homoclinic continuation from the selected cycle.',
    })
  }
  if (showHomoclinicFromHomoclinic) {
    workflowActions.push({
      id: 'homoclinic-from-homoclinic-toggle',
      group: 'Bifurcations',
      label: 'Restart homoclinic branch',
      description: 'Restart homoclinic continuation from the selected point.',
    })
  }
  if (showHomotopySaddleFromEquilibrium) {
    workflowActions.push({
      id: 'homotopy-saddle-from-equilibrium-toggle',
      group: 'Bifurcations',
      label: 'Homotopy-saddle continuation',
      description: 'Initialize the staged homotopy construction.',
    })
  }
  if (showHomoclinicFromHomotopySaddle) {
    workflowActions.push({
      id: 'homoclinic-from-homotopy-saddle-toggle',
      group: 'Bifurcations',
      label: 'Homoclinic from homotopy saddle',
      description: 'Create the homoclinic branch from a completed StageD point.',
    })
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

  const setOrbitPreviewPageIndex = useCallback(
    (page: number) => {
      if (orbitDisplayRows.length === 0) return
      const maxPage = Math.max(orbitPreviewPageCount - 1, 0)
      const nextPage = Math.min(Math.max(page, 0), maxPage)
      setOrbitPreviewPage(nextPage)
      setOrbitPreviewInput((nextPage + 1).toString())
      setOrbitPreviewError(null)
    },
    [orbitDisplayRows.length, orbitPreviewPageCount]
  )

  useEffect(() => {
    if (orbitDisplayRows.length === 0 || selectedOrbitPointIndex === null) return
    if (selectedOrbitPointIndex < 0 || selectedOrbitPointIndex >= orbitDisplayRows.length) return
    const targetPage = Math.floor(selectedOrbitPointIndex / ORBIT_PREVIEW_PAGE_SIZE)
    setOrbitPreviewPageIndex(targetPage)
  }, [
    orbitDisplayRows.length,
    orbitPointSelection,
    selectedOrbitPointIndex,
    setOrbitPreviewPageIndex,
  ])

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

  const setLimitCyclePreviewPageIndex = useCallback(
    (page: number) => {
      if (limitCycleProfilePoints.length === 0) return
      const maxPage = Math.max(limitCyclePreviewPageCount - 1, 0)
      const nextPage = Math.min(Math.max(page, 0), maxPage)
      setLimitCyclePreviewPage(nextPage)
      setLimitCyclePreviewInput((nextPage + 1).toString())
      setLimitCyclePreviewError(null)
    },
    [limitCyclePreviewPageCount, limitCycleProfilePoints.length]
  )

  useEffect(() => {
    if (limitCycleProfilePoints.length === 0 || selectedLimitCyclePointIndex === null) return
    if (
      selectedLimitCyclePointIndex < 0 ||
      selectedLimitCyclePointIndex >= limitCycleProfilePoints.length
    ) {
      return
    }
    const targetPage = Math.floor(selectedLimitCyclePointIndex / ORBIT_PREVIEW_PAGE_SIZE)
    setLimitCyclePreviewPageIndex(targetPage)
  }, [
    limitCyclePointSelection,
    limitCycleProfilePoints.length,
    selectedLimitCyclePointIndex,
    setLimitCyclePreviewPageIndex,
  ])

  const handleLimitCyclePreviewJump = () => {
    if (!limitCycle || limitCyclePreviewPageCount === 0) return
    const target = parseInteger(limitCyclePreviewInput)
    if (target === null) {
      setLimitCyclePreviewError('Enter a valid page number.')
      return
    }
    if (target < 1 || target > limitCyclePreviewPageCount) {
      setLimitCyclePreviewError(`Page must be between 1 and ${limitCyclePreviewPageCount}.`)
      return
    }
    setLimitCyclePreviewPageIndex(target - 1)
  }

  const handleParamOverrideChange = useCallback(
    (next: string[]) => {
      setParamOverrideDraft(next)
      if (!paramOverrideTarget || !selectedNodeId) return
      if (systemDraft.paramNames.length === 0) {
        setParamOverrideError('Add parameters to create an override.')
        return
      }
      const values = next.map((value) => parseNumber(value))
      if (values.some((value) => value === null)) {
        setParamOverrideError('Parameter values must be numeric.')
        return
      }
      setParamOverrideError(null)
      onUpdateObjectParams(
        selectedNodeId,
        values.map((value) => value ?? 0)
      )
    },
    [onUpdateObjectParams, paramOverrideTarget, selectedNodeId, systemDraft.paramNames.length]
  )

  const handlePasteParamOverride = async () => {
    const text = await readClipboardText()
    if (!text) return
    const values = parsePointValues(text)
    if (values.length === 0) return
    handleParamOverrideChange(
      applyPointValues(paramOverrideDraft, systemDraft.paramNames.length, values)
    )
  }

  const handlePasteOrbitState = async () => {
    const text = await readClipboardText()
    if (!text) return
    const values = parsePointValues(text)
    if (values.length === 0) return
    setOrbitDraft((prev) => ({
      ...prev,
      initialState: applyPointValues(
        prev.initialState,
        systemDraft.varNames.length,
        values
      ),
    }))
  }

  const handlePasteEquilibriumGuess = async () => {
    const text = await readClipboardText()
    if (!text) return
    const values = parsePointValues(text)
    if (values.length === 0) return
    setEquilibriumDraft((prev) => ({
      ...prev,
      initialGuess: applyPointValues(
        prev.initialGuess,
        systemDraft.varNames.length,
        values
      ),
    }))
  }

  const handleClearParamOverride = () => {
    if (!paramOverrideTarget || !selectedNodeId) return
    setParamOverrideError(null)
    onUpdateObjectParams(selectedNodeId, null)
    setParamOverrideDraft(
      adjustArray(
        systemDraft.params.map((value) => value.toString()),
        systemDraft.paramNames.length,
        () => '0'
      )
    )
  }

  const handleToggleFrozenVariable = useCallback(
    (variableName: string, frozen: boolean) => {
      if (!paramOverrideTarget || paramOverrideTarget.type === 'isocline' || !selectedNodeId) {
        return
      }
      const nextFrozen = { ...currentObjectFrozenValues }
      if (!frozen) {
        delete nextFrozen[variableName]
        onUpdateObjectFrozenVariables(selectedNodeId, nextFrozen)
        return
      }
      if (Object.keys(nextFrozen).length >= systemDraft.varNames.length) {
        return
      }
      const raw = frozenVariableDrafts[variableName]
      const parsed = parseDraftNumber(raw ?? '')
      nextFrozen[variableName] = parsed ?? 0
      onUpdateObjectFrozenVariables(selectedNodeId, nextFrozen)
    },
    [
      currentObjectFrozenValues,
      frozenVariableDrafts,
      onUpdateObjectFrozenVariables,
      paramOverrideTarget,
      selectedNodeId,
      systemDraft.varNames.length,
    ]
  )

  const handleFrozenVariableValueChange = useCallback(
    (variableName: string, rawValue: string) => {
      if (!paramOverrideTarget || paramOverrideTarget.type === 'isocline' || !selectedNodeId) {
        return
      }
      setFrozenVariableDrafts((prev) => ({ ...prev, [variableName]: rawValue }))
      if (!Object.prototype.hasOwnProperty.call(currentObjectFrozenValues, variableName)) {
        return
      }
      const parsed = parseDraftNumber(rawValue)
      if (parsed === null) return
      const nextFrozen = {
        ...currentObjectFrozenValues,
        [variableName]: parsed,
      }
      onUpdateObjectFrozenVariables(selectedNodeId, nextFrozen)
    },
    [
      currentObjectFrozenValues,
      onUpdateObjectFrozenVariables,
      paramOverrideTarget,
      selectedNodeId,
    ]
  )

  const handleUpdateIsocline = useCallback(
    (update: Partial<Omit<IsoclineObject, 'type' | 'name' | 'systemName'>>) => {
      if (!isocline || !selectedNodeId) return
      onUpdateIsoclineObject(selectedNodeId, update)
    },
    [isocline, onUpdateIsoclineObject, selectedNodeId]
  )

  const handleToggleIsoclineAxis = useCallback(
    (variableName: string, checked: boolean) => {
      if (!isocline) return
      setIsoclineError(null)
      const existing = isocline.axes
      if (checked) {
        if (existing.some((axis) => axis.variableName === variableName)) return
        if (existing.length >= isoclineMaxActiveVariables) return
        const nextCount = existing.length + 1
        handleUpdateIsocline({
          axes: [
            ...existing,
            {
              variableName,
              min: -2,
              max: 2,
              samples: defaultIsoclineSamples(nextCount),
            },
          ],
        })
        return
      }
      if (!existing.some((axis) => axis.variableName === variableName)) return
      if (existing.length <= 1) return
      handleUpdateIsocline({
        axes: existing.filter((axis) => axis.variableName !== variableName),
      })
    },
    [handleUpdateIsocline, isocline, isoclineMaxActiveVariables]
  )

  const handleUpdateIsoclineAxisField = useCallback(
    (
      variableName: string,
      field: 'min' | 'max' | 'samples',
      rawValue: string
    ) => {
      if (!isocline) return
      setIsoclineError(null)
      setIsoclineAxisDrafts((prev) => {
        const currentAxis = isocline.axes.find((axis) => axis.variableName === variableName)
        const current = prev[variableName] ?? {
          min: currentAxis?.min.toString() ?? '',
          max: currentAxis?.max.toString() ?? '',
          samples: currentAxis?.samples.toString() ?? '',
        }
        return {
          ...prev,
          [variableName]: {
            ...current,
            [field]: rawValue,
          },
        }
      })
      const nextAxes = isocline.axes.map((axis) => {
        if (axis.variableName !== variableName) return axis
        if (field === 'samples') {
          const parsed = parseDraftInteger(rawValue)
          if (parsed === null) return axis
          return { ...axis, samples: parsed }
        }
        const parsed = parseDraftNumber(rawValue)
        if (parsed === null) return axis
        return { ...axis, [field]: parsed }
      })
      handleUpdateIsocline({ axes: nextAxes })
    },
    [handleUpdateIsocline, isocline]
  )

  const handleUpdateIsoclineFrozenValue = useCallback(
    (variableName: string, variableIndex: number, rawValue: string) => {
      if (!isocline) return
      setIsoclineError(null)
      setIsoclineFrozenDrafts((prev) => ({
        ...prev,
        [variableName]: rawValue,
      }))
      const parsed = parseDraftNumber(rawValue)
      if (parsed === null) return
      const nextFrozen = [...isocline.frozenState]
      nextFrozen[variableIndex] = parsed
      handleUpdateIsocline({ frozenState: nextFrozen })
    },
    [handleUpdateIsocline, isocline]
  )

  const handleComputeIsocline = useCallback(async () => {
    if (!isocline || !selectedNodeId) return
    const parsedLevel = parseDraftNumber(isoclineLevelDraft)
    if (parsedLevel === null) {
      setIsoclineError('Isocline value must be a valid real number.')
      return
    }

    const parsedAxes: IsoclineObject['axes'] = []
    for (const axis of isocline.axes) {
      const draft = isoclineAxisDrafts[axis.variableName]
      const min = parseDraftNumber(draft?.min ?? axis.min.toString())
      if (min === null) {
        setIsoclineError(`Axis "${axis.variableName}" min must be a valid real number.`)
        return
      }
      const max = parseDraftNumber(draft?.max ?? axis.max.toString())
      if (max === null) {
        setIsoclineError(`Axis "${axis.variableName}" max must be a valid real number.`)
        return
      }
      const samples = parseDraftInteger(draft?.samples ?? axis.samples.toString())
      if (samples === null) {
        setIsoclineError(`Axis "${axis.variableName}" samples must be an integer.`)
        return
      }
      parsedAxes.push({
        ...axis,
        min,
        max,
        samples,
      })
    }

    const parsedFrozen = [...isocline.frozenState]
    for (const { name, index, value } of isoclineFrozenVariables) {
      const parsed = parseDraftNumber(isoclineFrozenDrafts[name] ?? value.toString())
      if (parsed === null) {
        setIsoclineError(`Frozen variable "${name}" must be a valid real number.`)
        return
      }
      parsedFrozen[index] = parsed
    }

    const pendingUpdate: Partial<Omit<IsoclineObject, 'type' | 'name' | 'systemName'>> = {}
    if (parsedLevel !== isocline.level) {
      pendingUpdate.level = parsedLevel
    }
    if (!isSameIsoclineAxes(parsedAxes, isocline.axes)) {
      pendingUpdate.axes = parsedAxes
    }
    if (!isSameNumberArray(parsedFrozen, isocline.frozenState)) {
      pendingUpdate.frozenState = parsedFrozen
    }
    if (Object.keys(pendingUpdate).length > 0) {
      handleUpdateIsocline(pendingUpdate)
    }

    isoclineComputeControllerRef.current?.abort()
    const controller = new AbortController()
    isoclineComputeControllerRef.current = controller
    setIsoclineComputing(true)
    setIsoclineError(null)
    try {
      const result = await onComputeIsocline(
        { isoclineId: selectedNodeId } satisfies IsoclineComputeRequest,
        { signal: controller.signal }
      )
      if (!result && !controller.signal.aborted) {
        setIsoclineError('Isocline compute failed. Check settings and try again.')
      }
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      setIsoclineError(message)
    } finally {
      if (isoclineComputeControllerRef.current === controller) {
        isoclineComputeControllerRef.current = null
      }
      if (!controller.signal.aborted) {
        setIsoclineComputing(false)
      }
    }
  }, [
    handleUpdateIsocline,
    isocline,
    isoclineAxisDrafts,
    isoclineFrozenDrafts,
    isoclineFrozenVariables,
    isoclineLevelDraft,
    onComputeIsocline,
    selectedNodeId,
  ])

  const handleSolveEquilibrium = async () => {
    if (runDisabled) {
      setEquilibriumError(`Apply valid system settings before solving ${equilibriumLabelPluralLower}.`)
      return
    }
    if (!object || object.type !== 'equilibrium' || !selectedNodeId) {
      setEquilibriumError(`Select the ${equilibriumLabelLower} to solve.`)
      return
    }
    const maxSteps = parseNumber(equilibriumDraft.maxSteps)
    const dampingFactor = parseNumber(equilibriumDraft.dampingFactor)
    const mapIterations = parseNumber(equilibriumDraft.mapIterations)
    const initialGuess = equilibriumDraft.initialGuess.map((value) => parseNumber(value))

    if (maxSteps === null || maxSteps <= 0) {
      setEquilibriumError('Max steps must be a positive number.')
      return
    }
    if (dampingFactor === null || dampingFactor <= 0) {
      setEquilibriumError('Damping factor must be a positive number.')
      return
    }
    if (systemDraft.type === 'map') {
      if (
        mapIterations === null ||
        mapIterations <= 0 ||
        !Number.isInteger(mapIterations)
      ) {
        setEquilibriumError('Cycle length must be a positive integer.')
        return
      }
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
      ...(systemDraft.type === 'map' ? { mapIterations: mapIterations ?? 1 } : {}),
    }
    await onSolveEquilibrium(request)
  }

  const handleCreateEquilibriumBranch = async () => {
    if (runDisabled) {
      setContinuationError('Apply valid system settings before continuing.')
      return
    }
    if (!equilibrium || !selectedNodeId) {
      setContinuationError(`Select the ${equilibriumLabelLower} to continue.`)
      return
    }
    if (!equilibrium.solution) {
      setContinuationError(`Solve the ${equilibriumLabelLower} before continuing.`)
      return
    }
    if (continuationParameterCount === 0) {
      setContinuationError('Add a parameter before continuing.')
      return
    }
    if (!continuationDraft.parameterName) {
      setContinuationError('Select a continuation parameter.')
      return
    }

    const suggestedName = buildSuggestedBranchName(
      equilibriumContinuationBaseName,
      continuationDraft.parameterName,
      existingBranchNames
    )
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

  const handleCreateEquilibriumManifold = async () => {
    if (runDisabled) {
      setEquilibriumManifoldError('Apply valid system settings before computing manifolds.')
      return
    }
    if (!equilibrium || !selectedNodeId) {
      setEquilibriumManifoldError(`Select the ${equilibriumLabelLower} to continue.`)
      return
    }
    if (!equilibrium.solution) {
      setEquilibriumManifoldError(`Solve the ${equilibriumLabelLower} before computing manifolds.`)
      return
    }

    const name = equilibriumManifoldDraft.name.trim()
    if (!name) {
      setEquilibriumManifoldError('Branch name is required.')
      return
    }
    if (!isCliSafeName(name)) {
      setEquilibriumManifoldError('Branch names must be alphanumeric with underscores only.')
      return
    }

    const isMapCurve1D = systemDraft.type === 'map' && equilibriumManifoldDraft.mode === 'curve_1d'
    const parsedCaps = parseManifoldCapsDraft(equilibriumManifoldDraft.caps, {
      requireMaxTime: !isMapCurve1D,
      requireMaxIterations: isMapCurve1D,
    })
    if (!parsedCaps.caps) {
      setEquilibriumManifoldError(parsedCaps.error ?? 'Invalid manifold caps.')
      return
    }

    if (equilibriumManifoldDraft.mode === 'curve_1d') {
      const eps = parseDraftNumber(equilibriumManifoldDraft.eps)
      const targetArclength = parseDraftNumber(equilibriumManifoldDraft.targetArclength)
      const parsedIntegrationDt = parseDraftNumber(equilibriumManifoldDraft.integrationDt)
      const integrationDt = systemDraft.type === 'map' ? 1 : parsedIntegrationDt
      if (
        eps === null ||
        targetArclength === null ||
        integrationDt === null
      ) {
        setEquilibriumManifoldError('1D manifold settings must be numeric.')
        return
      }
      if (
        eps <= 0 ||
        targetArclength <= 0 ||
        integrationDt === 0
      ) {
        setEquilibriumManifoldError(
          '1D manifold settings must be positive (integration dt must be non-zero).'
        )
        return
      }
      let eigIndex: number | undefined
      if (
        equilibriumManifoldEligibleIndexOptions.length !== 1 ||
        equilibriumManifoldEligibleRealIndexOptions.length !== 1
      ) {
        setEquilibriumManifoldError(
          `The ${equilibriumManifoldDraft.stability.toLowerCase()} eigenspace has dimension ${equilibriumManifoldEligibleIndexOptions.length}; the 1D manifold solver requires one real dimension.`
        )
        return
      }
      if (equilibriumManifoldDraft.eigIndex.trim().length > 0) {
        const parsed = parseDraftInteger(equilibriumManifoldDraft.eigIndex)
        if (parsed === null || parsed < 0) {
          setEquilibriumManifoldError('Eigen index must be a non-negative integer.')
          return
        }
        if (!equilibriumManifoldEligibleRealIndexSet.has(parsed.toString())) {
          setEquilibriumManifoldError(
            `Select an eligible ${equilibriumManifoldDraft.stability.toLowerCase()} real eigen index.`
          )
          return
        }
        eigIndex = parsed
      }
      setEquilibriumManifoldError(null)
      await onCreateEquilibriumManifold1D({
        equilibriumId: selectedNodeId,
        name,
        mapIterations: systemDraft.type === 'map' ? equilibriumMapIterations ?? 1 : undefined,
        settings: {
          stability: equilibriumManifoldDraft.stability,
          direction: equilibriumManifoldDraft.direction,
          eig_index: eigIndex,
          eps,
          target_arclength: targetArclength,
          integration_dt: integrationDt,
          caps: parsedCaps.caps,
        },
      })
      return
    }

    if (systemDraft.type === 'map') {
      setEquilibriumManifoldError('Map systems currently support 1D equilibrium manifolds only.')
      return
    }

    if (systemDraft.varNames.length < 3) {
      setEquilibriumManifoldError('2D equilibrium manifolds require at least three state variables.')
      return
    }
    const initialRadius = parseDraftNumber(equilibriumManifoldDraft.initialRadius)
    const leafDelta = parseDraftNumber(equilibriumManifoldDraft.leafDelta)
    const deltaMin = parseDraftNumber(equilibriumManifoldDraft.deltaMin)
    const ringPoints = parseDraftInteger(equilibriumManifoldDraft.ringPoints)
    const minSpacing = parseDraftNumber(equilibriumManifoldDraft.minSpacing)
    const maxSpacing = parseDraftNumber(equilibriumManifoldDraft.maxSpacing)
    const alphaMin = parseDraftNumber(equilibriumManifoldDraft.alphaMin)
    const alphaMax = parseDraftNumber(equilibriumManifoldDraft.alphaMax)
    const deltaAlphaMin = parseDraftNumber(equilibriumManifoldDraft.deltaAlphaMin)
    const deltaAlphaMax = parseDraftNumber(equilibriumManifoldDraft.deltaAlphaMax)
    const integrationDt = parseDraftNumber(equilibriumManifoldDraft.integrationDt)
    const targetRadius = parseDraftNumber(equilibriumManifoldDraft.targetRadius)
    const targetArclength = parseDraftNumber(equilibriumManifoldDraft.targetArclength)
    if (
      initialRadius === null ||
      leafDelta === null ||
      deltaMin === null ||
      ringPoints === null ||
      minSpacing === null ||
      maxSpacing === null ||
      alphaMin === null ||
      alphaMax === null ||
      deltaAlphaMin === null ||
      deltaAlphaMax === null ||
      integrationDt === null ||
      targetRadius === null ||
      targetArclength === null
    ) {
      setEquilibriumManifoldError('2D manifold settings must be numeric.')
      return
    }
    if (
      initialRadius <= 0 ||
      leafDelta <= 0 ||
      deltaMin <= 0 ||
      deltaMin > leafDelta ||
      ringPoints < 4 ||
      minSpacing <= 0 ||
      maxSpacing <= 0 ||
      maxSpacing <= minSpacing ||
      alphaMin <= 0 ||
      alphaMax <= 0 ||
      alphaMax <= alphaMin ||
      deltaAlphaMin <= 0 ||
      deltaAlphaMax <= 0 ||
      deltaAlphaMax <= deltaAlphaMin ||
      integrationDt === 0 ||
      targetRadius <= 0 ||
      targetArclength < 0
    ) {
      setEquilibriumManifoldError(
        '2D manifold settings are invalid. Check radius/delta positivity, spacing bounds, and alpha thresholds.'
      )
      return
    }
    let eigIndices: [number, number] | undefined
    if (equilibriumManifoldEligibleIndexOptions.length === 0) {
      setEquilibriumManifoldError(
        `No ${equilibriumManifoldDraft.stability.toLowerCase()} eigenmodes are available for 2D manifolds.`
      )
      return
    }
    const eigA = equilibriumManifoldDraft.eigIndexA.trim()
    const eigB = equilibriumManifoldDraft.eigIndexB.trim()
    if (eigA.length > 0 || eigB.length > 0) {
      const parsedA = parseDraftInteger(eigA)
      const parsedB = parseDraftInteger(eigB)
      if (parsedA === null || parsedB === null || parsedA < 0 || parsedB < 0) {
          setEquilibriumManifoldError('Eigenspace indices must be non-negative integers.')
          return
        }
      if (
        !equilibriumManifoldEligibleIndexSet.has(parsedA.toString()) ||
        !equilibriumManifoldEligibleIndexSet.has(parsedB.toString())
      ) {
        setEquilibriumManifoldError(
          `Select ${equilibriumManifoldDraft.stability.toLowerCase()} eigen indices for the 2D manifold.`
        )
        return
      }
      eigIndices = [parsedA, parsedB]
    }
    setEquilibriumManifoldError(null)
    await onCreateEquilibriumManifold2D({
      equilibriumId: selectedNodeId,
      name,
      settings: {
        stability: equilibriumManifoldDraft.stability,
        profile: toManifold2DProfile(equilibriumManifoldDraft.profile),
        eig_indices: eigIndices,
        initial_radius: initialRadius,
        leaf_delta: leafDelta,
        delta_min: deltaMin,
        ring_points: ringPoints,
        min_spacing: minSpacing,
        max_spacing: maxSpacing,
        alpha_min: alphaMin,
        alpha_max: alphaMax,
        delta_alpha_min: deltaAlphaMin,
        delta_alpha_max: deltaAlphaMax,
        integration_dt: integrationDt,
        target_radius: targetRadius,
        target_arclength: targetArclength,
        caps: parsedCaps.caps,
      },
    })
  }

  const handleCreateLimitCycleManifold = async () => {
    if (runDisabled) {
      setLimitCycleManifoldError('Apply valid system settings before computing manifolds.')
      return
    }
    if (systemDraft.type === 'map') {
      setLimitCycleManifoldError('Invariant manifolds are currently available for flow systems only.')
      return
    }
    if (!limitCycle || !selectedNodeId) {
      setLimitCycleManifoldError('Select a limit cycle to continue.')
      return
    }
    if (systemDraft.varNames.length < 3) {
      setLimitCycleManifoldError('2D cycle manifolds require at least three state variables.')
      return
    }

    const name = limitCycleManifoldDraft.name.trim()
    if (!name) {
      setLimitCycleManifoldError('Branch name is required.')
      return
    }
    if (!isCliSafeName(name)) {
      setLimitCycleManifoldError('Branch names must be alphanumeric with underscores only.')
      return
    }

    const parsedCaps = parseManifoldCapsDraft(limitCycleManifoldDraft.caps)
    if (!parsedCaps.caps) {
      setLimitCycleManifoldError(parsedCaps.error ?? 'Invalid manifold caps.')
      return
    }
    const initialRadius = parseDraftNumber(limitCycleManifoldDraft.initialRadius)
    const leafDelta = parseDraftNumber(limitCycleManifoldDraft.leafDelta)
    const deltaMin = parseDraftNumber(limitCycleManifoldDraft.deltaMin)
    const ringPoints = parseDraftInteger(limitCycleManifoldDraft.ringPoints)
    const minSpacing = parseDraftNumber(limitCycleManifoldDraft.minSpacing)
    const maxSpacing = parseDraftNumber(limitCycleManifoldDraft.maxSpacing)
    const alphaMin = parseDraftNumber(limitCycleManifoldDraft.alphaMin)
    const alphaMax = parseDraftNumber(limitCycleManifoldDraft.alphaMax)
    const deltaAlphaMin = parseDraftNumber(limitCycleManifoldDraft.deltaAlphaMin)
    const deltaAlphaMax = parseDraftNumber(limitCycleManifoldDraft.deltaAlphaMax)
    const integrationDt = parseDraftNumber(limitCycleManifoldDraft.integrationDt)
    const targetArclength = parseDraftNumber(limitCycleManifoldDraft.targetArclength)
    const ntst = parseDraftInteger(limitCycleManifoldDraft.ntst)
    const ncol = parseDraftInteger(limitCycleManifoldDraft.ncol)
    if (
      initialRadius === null ||
      leafDelta === null ||
      deltaMin === null ||
      ringPoints === null ||
      minSpacing === null ||
      maxSpacing === null ||
      alphaMin === null ||
      alphaMax === null ||
      deltaAlphaMin === null ||
      deltaAlphaMax === null ||
      integrationDt === null ||
      targetArclength === null ||
      ntst === null ||
      ncol === null
    ) {
      setLimitCycleManifoldError('Cycle manifold settings must be numeric.')
      return
    }
    if (
      initialRadius <= 0 ||
      leafDelta <= 0 ||
      deltaMin <= 0 ||
      deltaMin > leafDelta ||
      ringPoints < 4 ||
      minSpacing <= 0 ||
      maxSpacing <= 0 ||
      maxSpacing <= minSpacing ||
      alphaMin <= 0 ||
      alphaMax <= 0 ||
      alphaMax <= alphaMin ||
      deltaAlphaMin <= 0 ||
      deltaAlphaMax <= 0 ||
      deltaAlphaMax <= deltaAlphaMin ||
      integrationDt === 0 ||
      targetArclength < 0 ||
      ntst <= 0 ||
      ncol <= 0
    ) {
      setLimitCycleManifoldError(
        'Cycle manifold settings are invalid (ring points >= 4, ntst/ncol > 0, arclength >= 0).'
      )
      return
    }

    if (limitCycleManifoldEligibleFloquetIndexOptions.length === 0) {
      setLimitCycleManifoldError(
        'No eligible Floquet multipliers for the selected manifold stability (requires real, nontrivial, matching side).'
      )
      return
    }

    let floquetIndex: number | undefined
    if (limitCycleManifoldDraft.floquetIndex.trim().length > 0) {
      const parsed = parseDraftInteger(limitCycleManifoldDraft.floquetIndex)
      if (parsed === null || parsed < 0) {
        setLimitCycleManifoldError('Floquet index must be a non-negative integer.')
        return
      }
      if (!limitCycleManifoldEligibleFloquetIndexSet.has(parsed.toString())) {
        setLimitCycleManifoldError(
          'Selected Floquet index is not eligible for this manifold stability.'
        )
        return
      }
      floquetIndex = parsed
    }

    setLimitCycleManifoldError(null)
    await onCreateLimitCycleManifold2D({
      limitCycleId: selectedNodeId,
      name,
      settings: {
        stability: limitCycleManifoldDraft.stability,
        direction: limitCycleManifoldDraft.direction,
        algorithm: limitCycleManifoldDraft.algorithm,
        floquet_index: floquetIndex,
        profile: toManifold2DProfile(limitCycleManifoldDraft.profile),
        initial_radius: initialRadius,
        leaf_delta: leafDelta,
        delta_min: deltaMin,
        ring_points: ringPoints,
        min_spacing: minSpacing,
        max_spacing: maxSpacing,
        alpha_min: alphaMin,
        alpha_max: alphaMax,
        delta_alpha_min: deltaAlphaMin,
        delta_alpha_max: deltaAlphaMax,
        integration_dt: integrationDt,
        target_arclength: targetArclength,
        ntst,
        ncol,
        caps: parsedCaps.caps,
      },
    })
  }

  const setBranchPoint = useCallback(
    (arrayIndex: number, syncSelection = true) => {
      setBranchPointIndex(arrayIndex)
      const logicalIndex = branchIndices[arrayIndex]
      setBranchPointInput(
        typeof logicalIndex === 'number' ? logicalIndex.toString() : ''
      )
      setBranchPointError(null)
      if (syncSelection) {
        syncBranchPointSelection(arrayIndex)
      }
    },
    [branchIndices, syncBranchPointSelection]
  )

  useEffect(() => {
    const isInternalSelection = internalBranchPointSelectionRef.current
    internalBranchPointSelectionRef.current = false
    if (view !== 'selection') return
    if (!branch || !branchPointSelection || !selectedNodeId) return
    if (branchPointSelection.branchId !== selectedNodeId) return
    if (!isInternalSelection) {
      setBranchNavigatorOpen(true)
    }
    const targetIndex = branchPointSelection.pointIndex
    if (targetIndex === branchPointIndexRef.current) return
    if (targetIndex < 0 || targetIndex >= branchIndices.length) return
    setBranchPoint(targetIndex, false)
  }, [
    branch,
    branchIndices,
    branchPointSelection,
    setBranchPoint,
    selectedNodeId,
    setBranchNavigatorOpen,
    view,
  ])

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
    if (!branchSupportsContinueFromPoint) {
      const supportedLabel =
        systemDraft.type === 'flow'
          ? `${equilibriumLabelLower} or limit cycle`
          : equilibriumLabelLower
      setBranchContinuationError(
        `Continuation is only available for ${supportedLabel} branches.`
      )
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null) {
      setBranchContinuationError('Select a branch point to continue from.')
      return
    }
    if (continuationParameterCount === 0) {
      setBranchContinuationError('Add a parameter before continuing.')
      return
    }
    if (!branchContinuationDraft.parameterName) {
      setBranchContinuationError('Select a continuation parameter.')
      return
    }

    const suggestedName = suggestDefaultName('branchContinuation', {
      sourceName: branch.name,
      parameterName: branchContinuationDraft.parameterName,
      existingNames: existingBranchNames,
    })
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
        `Branch extension is only available for ${equilibriumLabelLower}, limit cycle, homoclinic, or bifurcation curve branches.`
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

  const handleExtendEquilibriumManifold1D = async () => {
    if (runDisabled) {
      setEquilibriumManifoldExtensionError(
        'Apply valid system settings before extending.'
      )
      return
    }
    if (!branch || !selectedNodeId || branch.branchType !== 'eq_manifold_1d') {
      setEquilibriumManifoldExtensionError(
        'Select a 1D equilibrium manifold branch to extend.'
      )
      return
    }
    const branchType = branch.data.branch_type
    if (!branchType || branchType.type !== 'ManifoldEq1D') {
      setEquilibriumManifoldExtensionError(
        'The manifold branch is missing its numerical metadata.'
      )
      return
    }
    const targetArclength = parseDraftNumber(
      equilibriumManifoldExtensionDraft.targetArclength
    )
    const parsedIntegrationDt = parseDraftNumber(
      equilibriumManifoldExtensionDraft.integrationDt
    )
    const integrationDt = systemDraft.type === 'map' ? 1 : parsedIntegrationDt
    if (targetArclength === null || targetArclength <= 0) {
      setEquilibriumManifoldExtensionError(
        'Additional arclength must be a positive number.'
      )
      return
    }
    if (integrationDt === null || integrationDt === 0) {
      setEquilibriumManifoldExtensionError('Integration dt must be non-zero.')
      return
    }
    const parsedCaps = parseManifoldCapsDraft(
      equilibriumManifoldExtensionDraft.caps,
      {
        requireMaxTime: systemDraft.type !== 'map',
        requireMaxIterations: systemDraft.type === 'map',
      }
    )
    if (!parsedCaps.caps) {
      setEquilibriumManifoldExtensionError(
        parsedCaps.error ?? 'Invalid manifold caps.'
      )
      return
    }
    const previousSettings = branch.manifoldSettings
    setEquilibriumManifoldExtensionError(null)
    await onExtendEquilibriumManifold1D({
      branchId: selectedNodeId,
      settings: {
        stability: branchType.stability,
        direction: branchType.direction,
        eig_index: branchType.eig_index,
        eps: previousSettings && 'eps' in previousSettings ? previousSettings.eps : 1e-3,
        target_arclength: targetArclength,
        integration_dt: integrationDt,
        caps: parsedCaps.caps,
        bounds: previousSettings?.bounds,
      },
    })
  }

  const handleExtendManifold2D = async () => {
    if (runDisabled) {
      setEquilibriumManifoldExtensionError(
        'Apply valid system settings before extending.'
      )
      return
    }
    if (
      !branch ||
      !selectedNodeId ||
      (branch.branchType !== 'eq_manifold_2d' &&
        branch.branchType !== 'cycle_manifold_2d')
    ) {
      setEquilibriumManifoldExtensionError(
        'Select a 2D invariant-manifold branch to extend.'
      )
      return
    }
    const targetArclength = parseDraftNumber(
      equilibriumManifoldExtensionDraft.targetArclength
    )
    const integrationDt = parseDraftNumber(
      equilibriumManifoldExtensionDraft.integrationDt
    )
    if (targetArclength === null || targetArclength <= 0) {
      setEquilibriumManifoldExtensionError(
        'Additional arclength must be a positive number.'
      )
      return
    }
    if (integrationDt === null || integrationDt === 0) {
      setEquilibriumManifoldExtensionError('Integration dt must be non-zero.')
      return
    }
    const parsedCaps = parseManifoldCapsDraft(
      equilibriumManifoldExtensionDraft.caps,
      { requireMaxTime: true }
    )
    if (!parsedCaps.caps) {
      setEquilibriumManifoldExtensionError(
        parsedCaps.error ?? 'Invalid manifold caps.'
      )
      return
    }
    setEquilibriumManifoldExtensionError(null)
    await onExtendManifold2D({
      branchId: selectedNodeId,
      targetArclength,
      integrationDt,
      caps: parsedCaps.caps,
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
      setFoldCurveError(`Fold curve continuation is only available for ${equilibriumLabelLower} branches.`)
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
    if (continuationParameterCount < 2) {
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

    const suggestedName = suggestDefaultName('foldCurve', {
      sourceName: branch.name,
      existingNames: existingBranchNames,
    })
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
    if (isDiscreteMap) {
      setHopfCurveError('Hopf curve continuation is only available for flow systems.')
      return
    }
    if (!branch || !selectedNodeId) {
      setHopfCurveError('Select a branch to continue.')
      return
    }
    if (branch.branchType !== 'equilibrium') {
      setHopfCurveError(
        `${hopfCurveLabel} curve continuation is only available for ${equilibriumLabelLower} branches.`
      )
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null) {
      setHopfCurveError('Select a branch point to continue from.')
      return
    }
    if (selectedBranchPoint.stability !== 'Hopf') {
      setHopfCurveError(`Select a ${hopfCurveLabel} bifurcation point to continue.`)
      return
    }
    if (continuationParameterCount < 2) {
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

    const suggestedName = suggestDefaultName('hopfCurve', {
      sourceName: branch.name,
      existingNames: existingBranchNames,
    })
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

  const handleCreateCodim2Branch = async (
    target: Codim2BranchCreationRequest['target']
  ) => {
    if (!branch || !selectedNodeId || !selectedBranchPoint || branchPointIndex === null) return
    const nameKind = target === 'Fold'
      ? 'foldCurve'
      : target === 'Hopf'
        ? 'hopfCurve'
        : target === 'Homoclinic'
          ? 'homoclinic'
          : 'continuationBranch'
    const name = suggestDefaultName(nameKind, {
      sourceName: branch.name,
      pointIndex: branchPointIndex,
      existingNames: existingBranchNames,
    })
    await onCreateCodim2BranchFromPoint({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      target,
      name,
      perturbation: target === 'LimitPointCycle' ? 0.05 : 0.02,
      ntst: 20,
      ncol: 4,
      tolerance: 1e-7,
      settings: {
        step_size: 0.01,
        min_step_size: 1e-5,
        max_step_size: 0.1,
        max_steps: 50,
        corrector_steps: 10,
        corrector_tolerance: 1e-8,
        step_tolerance: 1e-8,
      },
      forward: true,
    })
  }

  const handleCreateIsoperiodicCurve = async () => {
    if (runDisabled) {
      setIsoperiodicCurveError('Apply valid system settings before continuing.')
      return
    }
    if (isDiscreteMap) {
      setIsoperiodicCurveError('Isoperiodic curve continuation is only available for flow systems.')
      return
    }
    if (!branch || !selectedNodeId) {
      setIsoperiodicCurveError('Select a branch to continue.')
      return
    }
    if (branch.branchType !== 'limit_cycle' && branch.branchType !== 'isoperiodic_curve') {
      setIsoperiodicCurveError(
        'Isoperiodic curve continuation is only available for limit cycle or isoperiodic curve branches.'
      )
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null) {
      setIsoperiodicCurveError('Select a branch point to continue from.')
      return
    }
    const pointPeriod = selectedBranchPoint.state[selectedBranchPoint.state.length - 1]
    if (!Number.isFinite(pointPeriod) || pointPeriod <= 0) {
      setIsoperiodicCurveError('Selected point has no valid period.')
      return
    }
    if (continuationParameterCount < 2) {
      setIsoperiodicCurveError('Add another parameter before continuing.')
      return
    }
    if (!isoperiodicCurveDraft.parameterName) {
      setIsoperiodicCurveError('Select a first continuation parameter.')
      return
    }
    if (!continuationParameterSet.has(isoperiodicCurveDraft.parameterName)) {
      setIsoperiodicCurveError('Select a valid first continuation parameter.')
      return
    }
    if (!isoperiodicCurveDraft.param2Name) {
      setIsoperiodicCurveError('Select a second continuation parameter.')
      return
    }
    if (!continuationParameterSet.has(isoperiodicCurveDraft.param2Name)) {
      setIsoperiodicCurveError('Select a valid second continuation parameter.')
      return
    }
    if (isoperiodicCurveDraft.param2Name === isoperiodicCurveDraft.parameterName) {
      setIsoperiodicCurveError('Second parameter must be different from the first continuation parameter.')
      return
    }

    const suggestedName = suggestDefaultName('isoperiodicCurve', {
      sourceName: branch.name,
      existingNames: existingBranchNames,
    })
    const name = isoperiodicCurveDraft.name.trim() || suggestedName
    if (!name.trim()) {
      setIsoperiodicCurveError('Curve name is required.')
      return
    }
    if (!isCliSafeName(name)) {
      setIsoperiodicCurveError('Curve names must be alphanumeric with underscores only.')
      return
    }

    const { settings, error } = buildCodim1ContinuationSettings(isoperiodicCurveDraft)
    if (!settings) {
      setIsoperiodicCurveError(error ?? 'Invalid continuation settings.')
      return
    }

    setIsoperiodicCurveError(null)
    await onCreateIsoperiodicCurveFromPoint({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      name,
      parameterName: isoperiodicCurveDraft.parameterName,
      param2Name: isoperiodicCurveDraft.param2Name,
      settings,
      forward: isoperiodicCurveDraft.forward,
    })
  }

  const handleCreateLimitCycleCodim1Curve = async () => {
    if (runDisabled) {
      setLimitCycleCodim1CurveError('Apply valid system settings before continuing.')
      return
    }
    if (isDiscreteMap) {
      setLimitCycleCodim1CurveError(
        'Limit-cycle bifurcation curves are only available for flow systems.'
      )
      return
    }
    if (
      !branch ||
      !selectedNodeId ||
      (branch.branchType !== 'limit_cycle' &&
        branch.branchType !== 'lpc_curve' &&
        branch.branchType !== 'pd_curve' &&
        branch.branchType !== 'ns_curve')
    ) {
      setLimitCycleCodim1CurveError('Select a limit-cycle or cycle-curve branch to continue.')
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null || !limitCycleCodim1Curve) {
      setLimitCycleCodim1CurveError(
        'Select a cycle fold, period-doubling, or Neimark-Sacker point to continue.'
      )
      return
    }
    if (continuationParameterCount < 2) {
      setLimitCycleCodim1CurveError('Add another parameter before continuing.')
      return
    }
    if (!limitCycleCodim1CurveDraft.param2Name) {
      setLimitCycleCodim1CurveError('Select a second continuation parameter.')
      return
    }
    if (limitCycleCodim1CurveDraft.param2Name === branchParameterName) {
      setLimitCycleCodim1CurveError(
        'Second parameter must be different from the continuation parameter.'
      )
      return
    }

    const nameKind =
      limitCycleCodim1Curve.type === 'LimitPointCycle'
        ? 'lpcCurve'
        : limitCycleCodim1Curve.type === 'PeriodDoubling'
          ? 'pdCurve'
          : 'nsCurve'
    const suggestedName = suggestDefaultName(nameKind, {
      sourceName: branch.name,
      existingNames: existingBranchNames,
    })
    const name = limitCycleCodim1CurveDraft.name.trim() || suggestedName
    if (!name.trim()) {
      setLimitCycleCodim1CurveError('Curve name is required.')
      return
    }
    if (!isCliSafeName(name)) {
      setLimitCycleCodim1CurveError(
        'Curve names must be alphanumeric with underscores only.'
      )
      return
    }

    const { settings, error } = buildCodim1ContinuationSettings(
      limitCycleCodim1CurveDraft
    )
    if (!settings) {
      setLimitCycleCodim1CurveError(error ?? 'Invalid continuation settings.')
      return
    }

    setLimitCycleCodim1CurveError(null)
    await onCreateLimitCycleCodim1CurveFromPoint({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      curveType: limitCycleCodim1Curve.type,
      ...(Number.isFinite(limitCycleCodim1Curve.targetAuxiliary)
        ? { targetAuxiliary: limitCycleCodim1Curve.targetAuxiliary }
        : {}),
      name,
      param2Name: limitCycleCodim1CurveDraft.param2Name,
      settings,
      forward: limitCycleCodim1CurveDraft.forward,
    })
  }

  const handleCreateNSCurve = async () => {
    if (runDisabled) {
      setNSCurveError('Apply valid system settings before continuing.')
      return
    }
    if (!isDiscreteMap) {
      setNSCurveError('Neimark-Sacker curve continuation is only available for map systems.')
      return
    }
    if (!branch || !selectedNodeId) {
      setNSCurveError('Select a branch to continue.')
      return
    }
    if (branch.branchType !== 'equilibrium') {
      setNSCurveError(
        `${nsCurveLabel} curve continuation is only available for ${equilibriumLabelLower} branches.`
      )
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null) {
      setNSCurveError('Select a branch point to continue from.')
      return
    }
    if (selectedBranchPoint.stability !== 'NeimarkSacker') {
      setNSCurveError(`Select a ${nsCurveLabel} bifurcation point to continue.`)
      return
    }
    if (continuationParameterCount < 2) {
      setNSCurveError('Add another parameter before continuing.')
      return
    }
    if (!nsCurveDraft.param2Name) {
      setNSCurveError('Select a second continuation parameter.')
      return
    }
    if (nsCurveDraft.param2Name === branchParameterName) {
      setNSCurveError('Second parameter must be different from the continuation parameter.')
      return
    }

    const suggestedName = suggestDefaultName('nsCurve', {
      sourceName: branch.name,
      existingNames: existingBranchNames,
    })
    const name = nsCurveDraft.name.trim() || suggestedName
    if (!name.trim()) {
      setNSCurveError('Curve name is required.')
      return
    }
    if (!isCliSafeName(name)) {
      setNSCurveError('Curve names must be alphanumeric with underscores only.')
      return
    }

    const { settings, error } = buildCodim1ContinuationSettings(nsCurveDraft)
    if (!settings) {
      setNSCurveError(error ?? 'Invalid continuation settings.')
      return
    }

    setNSCurveError(null)
    await onCreateNSCurveFromPoint({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      name,
      param2Name: nsCurveDraft.param2Name,
      settings,
      forward: nsCurveDraft.forward,
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
    if (!continuationParameterSet.has(limitCycleFromHopfDraft.parameterName)) {
      setLimitCycleFromHopfError('Continuation parameter is not defined in this system.')
      return
    }

    const limitCycleName =
      limitCycleFromHopfDraft.limitCycleName.trim() ||
      suggestDefaultName('limitCycle', {
        sourceName: branch.name,
        existingNames: existingObjectNames,
      })
    if (!limitCycleName) {
      setLimitCycleFromHopfError('Limit cycle name is required.')
      return
    }
    if (!isCliSafeName(limitCycleName)) {
      setLimitCycleFromHopfError('Limit cycle names must be alphanumeric with underscores only.')
      return
    }

    const branchName =
      limitCycleFromHopfDraft.branchName.trim() || limitCycleFromHopfBranchSuggestion
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
      ...limitCycleFromHopfDraft,
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


  const handleCreateCycleFromPD = async () => {
    if (runDisabled) {
      setLimitCycleFromPDError('Apply valid system settings before continuing.')
      return
    }
    if (!branch || !selectedNodeId) {
      setLimitCycleFromPDError('Select a branch to continue.')
      return
    }
    if (systemDraft.type !== 'map') {
      setLimitCycleFromPDError('Cycle continuation is only available for map systems.')
      return
    }
    if (branch.branchType !== 'equilibrium') {
      setLimitCycleFromPDError('Period-doubling branching for maps requires a cycle branch.')
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
    if (!branchParameterName || !continuationParameterSet.has(branchParameterName)) {
      setLimitCycleFromPDError('Continuation parameter is not defined in this system.')
      return
    }

    const cycleName =
      limitCycleFromPDDraft.limitCycleName.trim() || limitCycleFromPDNameSuggestion
    if (!cycleName) {
      setLimitCycleFromPDError('Cycle name is required.')
      return
    }
    if (!isCliSafeName(cycleName)) {
      setLimitCycleFromPDError('Cycle names must be alphanumeric with underscores only.')
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

    const maxSteps = parseNumber(equilibriumDraft.maxSteps)
    if (maxSteps === null || maxSteps <= 0) {
      setLimitCycleFromPDError('Max steps must be a positive number.')
      return
    }
    const dampingFactor = parseNumber(equilibriumDraft.dampingFactor)
    if (dampingFactor === null || dampingFactor <= 0) {
      setLimitCycleFromPDError('Damping factor must be a positive number.')
      return
    }

    const { settings, error } = buildContinuationSettings({
      ...limitCycleFromPDDraft,
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
    await onCreateCycleFromPD({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      cycleName,
      branchName,
      amplitude,
      settings,
      forward: limitCycleFromPDDraft.forward,
      solverParams: {
        maxSteps,
        dampingFactor,
      },
    })
  }

  const handleCreateLimitCycleFromPD = async () => {
    if (runDisabled) {
      setLimitCycleFromPDError('Apply valid system settings before continuing.')
      return
    }
    if (!branch || !selectedNodeId) {
      setLimitCycleFromPDError('Select a branch to continue.')
      return
    }
    if (systemDraft.type === 'map') {
      setLimitCycleFromPDError('Limit cycle continuation requires a flow system.')
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
    if (!branchParameterName || !continuationParameterSet.has(branchParameterName)) {
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

    const { settings, error } = buildContinuationSettings({
      ...limitCycleFromPDDraft,
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
      settings,
      forward: limitCycleFromPDDraft.forward,
    })
  }

  const handleCreateHomoclinicFromLargeCycle = async () => {
    if (runDisabled) {
      setHomoclinicFromLargeCycleError('Apply valid system settings before continuing.')
      return
    }
    if (systemDraft.type === 'map') {
      setHomoclinicFromLargeCycleError('Homoclinic continuation requires a flow system.')
      return
    }
    if (!branch || !selectedNodeId) {
      setHomoclinicFromLargeCycleError('Select a branch to continue.')
      return
    }
    if (branch.branchType !== 'limit_cycle') {
      setHomoclinicFromLargeCycleError(
        'Homoclinic initialization from a cycle requires a limit cycle branch.'
      )
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null) {
      setHomoclinicFromLargeCycleError('Select a branch point to continue from.')
      return
    }
    if (continuationParameterCount < 2) {
      setHomoclinicFromLargeCycleError('Add another parameter before continuing.')
      return
    }
    if (!continuationParameterSet.has(homoclinicFromLargeCycleDraft.parameterName)) {
      setHomoclinicFromLargeCycleError('Select a valid first continuation parameter.')
      return
    }
    if (!continuationParameterSet.has(homoclinicFromLargeCycleDraft.param2Name)) {
      setHomoclinicFromLargeCycleError('Select a valid second continuation parameter.')
      return
    }
    if (homoclinicFromLargeCycleDraft.parameterName === homoclinicFromLargeCycleDraft.param2Name) {
      setHomoclinicFromLargeCycleError(
        'Second parameter must be different from the continuation parameter.'
      )
      return
    }

    const name =
      homoclinicFromLargeCycleDraft.name.trim() ||
      suggestDefaultName('homoclinic', {
        sourceName: branch.name,
        existingNames: existingBranchNames,
      })
    if (!name) {
      setHomoclinicFromLargeCycleError('Branch name is required.')
      return
    }
    if (!isCliSafeName(name)) {
      setHomoclinicFromLargeCycleError(
        'Branch names must be alphanumeric with underscores only.'
      )
      return
    }

    const targetNtst = parseInteger(homoclinicFromLargeCycleDraft.targetNtst)
    if (targetNtst === null || targetNtst < 2) {
      setHomoclinicFromLargeCycleError('Target NTST must be an integer greater than or equal to 2.')
      return
    }
    const targetNcol = parseInteger(homoclinicFromLargeCycleDraft.targetNcol)
    if (targetNcol === null || targetNcol < 1) {
      setHomoclinicFromLargeCycleError('Target NCOL must be a positive integer.')
      return
    }
    if (
      !homoclinicFromLargeCycleDraft.freeTime &&
      !homoclinicFromLargeCycleDraft.freeEps0 &&
      !homoclinicFromLargeCycleDraft.freeEps1
    ) {
      setHomoclinicFromLargeCycleError('At least one of T, eps0, or eps1 must be free.')
      return
    }

    const { settings, error } = buildContinuationSettings({
      name: '',
      parameterName: homoclinicFromLargeCycleDraft.parameterName,
      stepSize: homoclinicFromLargeCycleDraft.stepSize,
      maxSteps: homoclinicFromLargeCycleDraft.maxSteps,
      minStepSize: homoclinicFromLargeCycleDraft.minStepSize,
      maxStepSize: homoclinicFromLargeCycleDraft.maxStepSize,
      correctorSteps: homoclinicFromLargeCycleDraft.correctorSteps,
      correctorTolerance: homoclinicFromLargeCycleDraft.correctorTolerance,
      stepTolerance: homoclinicFromLargeCycleDraft.stepTolerance,
      forward: homoclinicFromLargeCycleDraft.forward,
    })
    if (!settings) {
      setHomoclinicFromLargeCycleError(error ?? 'Invalid continuation settings.')
      return
    }

    setHomoclinicFromLargeCycleError(null)
    await onCreateHomoclinicFromLargeCycle({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      name,
      parameterName: homoclinicFromLargeCycleDraft.parameterName,
      param2Name: homoclinicFromLargeCycleDraft.param2Name,
      targetNtst,
      targetNcol,
      freeTime: homoclinicFromLargeCycleDraft.freeTime,
      freeEps0: homoclinicFromLargeCycleDraft.freeEps0,
      freeEps1: homoclinicFromLargeCycleDraft.freeEps1,
      settings,
      forward: homoclinicFromLargeCycleDraft.forward,
    })
  }

  const handleCreateHomoclinicFromHomoclinic = async () => {
    if (runDisabled) {
      setHomoclinicFromHomoclinicError('Apply valid system settings before continuing.')
      return
    }
    if (systemDraft.type === 'map') {
      setHomoclinicFromHomoclinicError('Homoclinic continuation requires a flow system.')
      return
    }
    if (!branch || !selectedNodeId) {
      setHomoclinicFromHomoclinicError('Select a branch to continue.')
      return
    }
    if (branch.branchType !== 'homoclinic_curve') {
      setHomoclinicFromHomoclinicError(
        'Homoclinic reinitialization requires an existing homoclinic branch.'
      )
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null) {
      setHomoclinicFromHomoclinicError('Select a branch point to continue from.')
      return
    }
    if (
      !branch.data.branch_type ||
      typeof branch.data.branch_type !== 'object' ||
      !('type' in branch.data.branch_type) ||
      branch.data.branch_type.type !== 'HomoclinicCurve'
    ) {
      setHomoclinicFromHomoclinicError('Source homoclinic branch is missing metadata.')
      return
    }
    if (continuationParameterCount < 2) {
      setHomoclinicFromHomoclinicError('Add another parameter before continuing.')
      return
    }
    if (!continuationParameterSet.has(homoclinicFromHomoclinicDraft.parameterName)) {
      setHomoclinicFromHomoclinicError('Select a valid first continuation parameter.')
      return
    }
    if (!continuationParameterSet.has(homoclinicFromHomoclinicDraft.param2Name)) {
      setHomoclinicFromHomoclinicError('Select a valid second continuation parameter.')
      return
    }
    if (homoclinicFromHomoclinicDraft.parameterName === homoclinicFromHomoclinicDraft.param2Name) {
      setHomoclinicFromHomoclinicError(
        'Second parameter must be different from the continuation parameter.'
      )
      return
    }

    const name =
      homoclinicFromHomoclinicDraft.name.trim() ||
      suggestDefaultName('homoclinicRestart', {
        sourceName: branch.name,
        existingNames: existingBranchNames,
      })
    if (!name) {
      setHomoclinicFromHomoclinicError('Branch name is required.')
      return
    }
    if (!isCliSafeName(name)) {
      setHomoclinicFromHomoclinicError(
        'Branch names must be alphanumeric with underscores only.'
      )
      return
    }

    const targetNtst = parseInteger(homoclinicFromHomoclinicDraft.targetNtst)
    if (targetNtst === null || targetNtst < 2) {
      setHomoclinicFromHomoclinicError('Target NTST must be an integer greater than or equal to 2.')
      return
    }
    const targetNcol = parseInteger(homoclinicFromHomoclinicDraft.targetNcol)
    if (targetNcol === null || targetNcol < 1) {
      setHomoclinicFromHomoclinicError('Target NCOL must be a positive integer.')
      return
    }
    if (
      !homoclinicFromHomoclinicDraft.freeTime &&
      !homoclinicFromHomoclinicDraft.freeEps0 &&
      !homoclinicFromHomoclinicDraft.freeEps1
    ) {
      setHomoclinicFromHomoclinicError('At least one of T, eps0, or eps1 must be free.')
      return
    }

    const { settings, error } = buildContinuationSettings({
      name: '',
      parameterName: homoclinicFromHomoclinicDraft.parameterName,
      stepSize: homoclinicFromHomoclinicDraft.stepSize,
      maxSteps: homoclinicFromHomoclinicDraft.maxSteps,
      minStepSize: homoclinicFromHomoclinicDraft.minStepSize,
      maxStepSize: homoclinicFromHomoclinicDraft.maxStepSize,
      correctorSteps: homoclinicFromHomoclinicDraft.correctorSteps,
      correctorTolerance: homoclinicFromHomoclinicDraft.correctorTolerance,
      stepTolerance: homoclinicFromHomoclinicDraft.stepTolerance,
      forward: homoclinicFromHomoclinicDraft.forward,
    })
    if (!settings) {
      setHomoclinicFromHomoclinicError(error ?? 'Invalid continuation settings.')
      return
    }

    setHomoclinicFromHomoclinicError(null)
    await onCreateHomoclinicFromHomoclinic({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      name,
      parameterName: homoclinicFromHomoclinicDraft.parameterName,
      param2Name: homoclinicFromHomoclinicDraft.param2Name,
      targetNtst,
      targetNcol,
      freeTime: homoclinicFromHomoclinicDraft.freeTime,
      freeEps0: homoclinicFromHomoclinicDraft.freeEps0,
      freeEps1: homoclinicFromHomoclinicDraft.freeEps1,
      settings,
      forward: homoclinicFromHomoclinicDraft.forward,
    })
  }

  const handleCreateHomotopySaddleFromEquilibrium = async () => {
    if (runDisabled) {
      setHomotopySaddleFromEquilibriumError('Apply valid system settings before continuing.')
      return
    }
    if (systemDraft.type === 'map') {
      setHomotopySaddleFromEquilibriumError(
        'Homotopy-saddle continuation requires a flow system.'
      )
      return
    }
    if (!branch || !selectedNodeId) {
      setHomotopySaddleFromEquilibriumError('Select a branch to continue.')
      return
    }
    if (branch.branchType !== 'equilibrium') {
      setHomotopySaddleFromEquilibriumError(
        `Homotopy-saddle continuation is only available for ${equilibriumLabelLower} branches.`
      )
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null) {
      setHomotopySaddleFromEquilibriumError('Select a branch point to continue from.')
      return
    }
    if (continuationParameterCount < 2) {
      setHomotopySaddleFromEquilibriumError('Add another parameter before continuing.')
      return
    }
    if (!continuationParameterSet.has(homotopySaddleFromEquilibriumDraft.parameterName)) {
      setHomotopySaddleFromEquilibriumError('Select a valid first continuation parameter.')
      return
    }
    if (!continuationParameterSet.has(homotopySaddleFromEquilibriumDraft.param2Name)) {
      setHomotopySaddleFromEquilibriumError('Select a valid second continuation parameter.')
      return
    }
    if (
      homotopySaddleFromEquilibriumDraft.parameterName ===
      homotopySaddleFromEquilibriumDraft.param2Name
    ) {
      setHomotopySaddleFromEquilibriumError(
        'Second parameter must be different from the continuation parameter.'
      )
      return
    }

    const name =
      homotopySaddleFromEquilibriumDraft.name.trim() ||
      suggestDefaultName('homotopySaddle', {
        sourceName: branch.name,
        existingNames: existingBranchNames,
      })
    if (!name) {
      setHomotopySaddleFromEquilibriumError('Branch name is required.')
      return
    }
    if (!isCliSafeName(name)) {
      setHomotopySaddleFromEquilibriumError(
        'Branch names must be alphanumeric with underscores only.'
      )
      return
    }

    const ntst = parseInteger(homotopySaddleFromEquilibriumDraft.ntst)
    if (ntst === null || ntst < 2) {
      setHomotopySaddleFromEquilibriumError('NTST must be an integer greater than or equal to 2.')
      return
    }
    const ncol = parseInteger(homotopySaddleFromEquilibriumDraft.ncol)
    if (ncol === null || ncol < 1) {
      setHomotopySaddleFromEquilibriumError('NCOL must be a positive integer.')
      return
    }
    const eps0 = parseNumber(homotopySaddleFromEquilibriumDraft.eps0)
    if (eps0 === null || eps0 <= 0) {
      setHomotopySaddleFromEquilibriumError('eps0 must be a positive number.')
      return
    }
    const eps1 = parseNumber(homotopySaddleFromEquilibriumDraft.eps1)
    if (eps1 === null || eps1 <= 0) {
      setHomotopySaddleFromEquilibriumError('eps1 must be a positive number.')
      return
    }
    const time = parseNumber(homotopySaddleFromEquilibriumDraft.time)
    if (time === null || time <= 0) {
      setHomotopySaddleFromEquilibriumError('T must be a positive number.')
      return
    }
    const eps1Tol = parseNumber(homotopySaddleFromEquilibriumDraft.eps1Tol)
    if (eps1Tol === null || eps1Tol <= 0) {
      setHomotopySaddleFromEquilibriumError('eps1 tolerance must be a positive number.')
      return
    }

    const { settings, error } = buildContinuationSettings({
      name: '',
      parameterName: homotopySaddleFromEquilibriumDraft.parameterName,
      stepSize: homotopySaddleFromEquilibriumDraft.stepSize,
      maxSteps: homotopySaddleFromEquilibriumDraft.maxSteps,
      minStepSize: homotopySaddleFromEquilibriumDraft.minStepSize,
      maxStepSize: homotopySaddleFromEquilibriumDraft.maxStepSize,
      correctorSteps: homotopySaddleFromEquilibriumDraft.correctorSteps,
      correctorTolerance: homotopySaddleFromEquilibriumDraft.correctorTolerance,
      stepTolerance: homotopySaddleFromEquilibriumDraft.stepTolerance,
      forward: homotopySaddleFromEquilibriumDraft.forward,
    })
    if (!settings) {
      setHomotopySaddleFromEquilibriumError(error ?? 'Invalid continuation settings.')
      return
    }

    setHomotopySaddleFromEquilibriumError(null)
    await onCreateHomotopySaddleFromEquilibrium({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      name,
      parameterName: homotopySaddleFromEquilibriumDraft.parameterName,
      param2Name: homotopySaddleFromEquilibriumDraft.param2Name,
      ntst,
      ncol,
      eps0,
      eps1,
      time,
      eps1Tol,
      settings,
      forward: homotopySaddleFromEquilibriumDraft.forward,
    })
  }

  const handleCreateHomoclinicFromHomotopySaddle = async () => {
    if (runDisabled) {
      setHomoclinicFromHomotopySaddleError('Apply valid system settings before continuing.')
      return
    }
    if (systemDraft.type === 'map') {
      setHomoclinicFromHomotopySaddleError('Homoclinic continuation requires a flow system.')
      return
    }
    if (!branch || !selectedNodeId) {
      setHomoclinicFromHomotopySaddleError('Select a branch to continue.')
      return
    }
    if (branch.branchType !== 'homotopy_saddle_curve') {
      setHomoclinicFromHomotopySaddleError(
        'Homoclinic initialization from homotopy-saddle requires a homotopy-saddle branch.'
      )
      return
    }
    if (!selectedBranchPoint || branchPointIndex === null) {
      setHomoclinicFromHomotopySaddleError('Select a branch point to continue from.')
      return
    }
    if (
      !branch.data.branch_type ||
      typeof branch.data.branch_type !== 'object' ||
      !('type' in branch.data.branch_type) ||
      branch.data.branch_type.type !== 'HomotopySaddleCurve'
    ) {
      setHomoclinicFromHomotopySaddleError('Source homotopy-saddle branch is missing metadata.')
      return
    }
    if (branch.data.branch_type.stage !== 'StageD') {
      setHomoclinicFromHomotopySaddleError(
        'Method 3 initialization requires selecting a StageD homotopy-saddle branch.'
      )
      return
    }

    const name =
      homoclinicFromHomotopySaddleDraft.name.trim() ||
      suggestDefaultName('homoclinicStageD', {
        sourceName: branch.name,
        existingNames: existingBranchNames,
      })
    if (!name) {
      setHomoclinicFromHomotopySaddleError('Branch name is required.')
      return
    }
    if (!isCliSafeName(name)) {
      setHomoclinicFromHomotopySaddleError(
        'Branch names must be alphanumeric with underscores only.'
      )
      return
    }

    const targetNtst = parseInteger(homoclinicFromHomotopySaddleDraft.targetNtst)
    if (targetNtst === null || targetNtst < 2) {
      setHomoclinicFromHomotopySaddleError(
        'Target NTST must be an integer greater than or equal to 2.'
      )
      return
    }
    const targetNcol = parseInteger(homoclinicFromHomotopySaddleDraft.targetNcol)
    if (targetNcol === null || targetNcol < 1) {
      setHomoclinicFromHomotopySaddleError('Target NCOL must be a positive integer.')
      return
    }
    if (
      !homoclinicFromHomotopySaddleDraft.freeTime &&
      !homoclinicFromHomotopySaddleDraft.freeEps0 &&
      !homoclinicFromHomotopySaddleDraft.freeEps1
    ) {
      setHomoclinicFromHomotopySaddleError('At least one of T, eps0, or eps1 must be free.')
      return
    }

    const { settings, error } = buildContinuationSettings({
      name: '',
      parameterName: branch.parameterName,
      stepSize: homoclinicFromHomotopySaddleDraft.stepSize,
      maxSteps: homoclinicFromHomotopySaddleDraft.maxSteps,
      minStepSize: homoclinicFromHomotopySaddleDraft.minStepSize,
      maxStepSize: homoclinicFromHomotopySaddleDraft.maxStepSize,
      correctorSteps: homoclinicFromHomotopySaddleDraft.correctorSteps,
      correctorTolerance: homoclinicFromHomotopySaddleDraft.correctorTolerance,
      stepTolerance: homoclinicFromHomotopySaddleDraft.stepTolerance,
      forward: homoclinicFromHomotopySaddleDraft.forward,
    })
    if (!settings) {
      setHomoclinicFromHomotopySaddleError(error ?? 'Invalid continuation settings.')
      return
    }

    setHomoclinicFromHomotopySaddleError(null)
    await onCreateHomoclinicFromHomotopySaddle({
      branchId: selectedNodeId,
      pointIndex: branchPointIndex,
      name,
      targetNtst,
      targetNcol,
      freeTime: homoclinicFromHomotopySaddleDraft.freeTime,
      freeEps0: homoclinicFromHomotopySaddleDraft.freeEps0,
      freeEps1: homoclinicFromHomotopySaddleDraft.freeEps1,
      settings,
      forward: homoclinicFromHomotopySaddleDraft.forward,
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
    if (continuationParameterCount === 0) {
      setLimitCycleFromOrbitError('Add a parameter before continuing.')
      return
    }
    if (!continuationParameterSet.has(limitCycleFromOrbitDraft.parameterName)) {
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
      ...limitCycleFromOrbitDraft,
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

  const updateLimitCycleFloquetRender = useCallback(
    (update: Partial<EquilibriumEigenvectorRenderStyle>) => {
      if (!selectionNode) return
      const merged = resolveEquilibriumEigenvectorRender(
        { ...limitCycleFloquetRender, ...update },
        limitCycleFloquetEigenspaceIndices
      )
      onUpdateRender(selectionNode.id, { equilibriumEigenvectors: merged })
    },
    [
      limitCycleFloquetEigenspaceIndices,
      limitCycleFloquetRender,
      onUpdateRender,
      selectionNode,
    ]
  )

  const handleLimitCycleFloquetVisibilityChange = (index: number, visible: boolean) => {
    const nextSet = new Set(limitCycleFloquetRender.vectorIndices)
    if (visible) {
      nextSet.add(index)
    } else {
      nextSet.delete(index)
    }
    const nextIndices = limitCycleFloquetIndices.filter((value) => nextSet.has(value))
    const colors = resolveEquilibriumEigenvectorColors(
      nextIndices,
      limitCycleFloquetRender.vectorIndices,
      limitCycleFloquetRender.colors,
      limitCycleFloquetRender.colorOverrides
    )
    updateLimitCycleFloquetRender({ vectorIndices: nextIndices, colors })
  }

  const handleLimitCycleFloquetColorChange = (index: number, color: string) => {
    const colorIndex = limitCycleFloquetRender.vectorIndices.indexOf(index)
    if (colorIndex === -1) return
    const colors = limitCycleFloquetRender.colors.map((value, idx) =>
      idx === colorIndex ? color : value
    )
    updateLimitCycleFloquetRender({ colors })
  }

  const handleComputeLimitCycleFloquetModes = async () => {
    if (!limitCycle || !selectedNodeId) return
    setLimitCycleFloquetModesError(null)
    try {
      await onComputeLimitCycleFloquetModes({
        limitCycleId: selectedNodeId,
        backend: limitCycleFloquetBackend,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLimitCycleFloquetModesError(message)
    }
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

  const lyapunovDimension =
    orbit?.lyapunovExponents && orbit.lyapunovExponents.length > 0
      ? kaplanYorkeDimension(orbit.lyapunovExponents)
      : null
  const clvHasData = Boolean(
    orbit?.covariantVectors && orbit.covariantVectors.vectors.length > 0
  )
  const clvNeeds2d = clvPlotDim < 2
  const selectionPayloadPending = Boolean(
    selectionNode &&
      ((selectionNode.kind === 'object' &&
        !object &&
        Boolean(system.index.objects[selectionNode.id])) ||
        (selectionNode.kind === 'branch' &&
          !branch &&
          Boolean(system.index.branches[selectionNode.id])))
  )

    return {
    AnalysisViewportInspector,
    BranchNavigatorContent,
    InspectorDisclosure,
    InspectorMetrics,
    PlotlyViewport,
    StateTable,
    WorkflowActionList,
    WorkflowFocusToolbar,
    activeFrozenVariableRef,
    analysis,
    axisOptions,
    branch,
    branchBifurcations,
    branchContinuationDraft,
    branchContinuationError,
    branchCyclePoints,
    branchEigenPlot,
    branchEigenvalues,
    branchEndPoint,
    branchEntries,
    branchExtensionDraft,
    branchExtensionError,
    branchIndices,
    branchMultiplierPlot,
    branchNavigatorOpen,
    branchParameterName,
    branchParams,
    branchPointError,
    branchPointIndex,
    branchPointInput,
    branchSortedIndex,
    branchSortedOrder,
    branchStartPoint,
    branchSupportsContinueFromPoint,
    buildSuggestedBranchName,
    canExtendBranch,
    canExtendInvariantManifold,
    canRenderStoredCycle,
    clvColors,
    clvHasData,
    clvIndices,
    clvNeeds2d,
    clvPlotDim,
    clvRender,
    clvVisibleSet,
    codim1ParamOptions,
    commitSelectionName,
    continuationDraft,
    continuationError,
    continuationParameterCount,
    continuationParameterLabels,
    continuationParameterSet,
    covariantDraft,
    covariantError,
    currentObjectFrozenValues,
    diagram,
    diagramFilteredBranches,
    diagramSearch,
    diagramSelectedEntries,
    diagramSelectedIds,
    diagramSelectedSet,
    equilibrium,
    equilibriumContinuationBaseName,
    equilibriumCyclePoints,
    equilibriumDisplayState,
    equilibriumDraft,
    equilibriumEigenPlot,
    equilibriumEigenpairs,
    equilibriumEigenvectorColors,
    equilibriumEigenvectorIndices,
    equilibriumEigenvectorRender,
    equilibriumEigenvectorVisibleSet,
    equilibriumError,
    equilibriumHasEigenvectors,
    equilibriumLabel,
    equilibriumLabelLower,
    equilibriumLabelPluralLower,
    equilibriumManifoldDraft,
    equilibriumManifoldEligibleIndexOptions,
    equilibriumManifoldEligibleRealIndexOptions,
    equilibriumManifoldError,
    equilibriumManifoldExtensionDraft,
    equilibriumManifoldExtensionError,
    equilibriumManifoldModeOptions,
    existingBranchNames,
    existingObjectNames,
    foldCurveDraft,
    foldCurveError,
    formatAxisValue,
    formatBranchType,
    formatComplexValue,
    formatFixed,
    formatLimitCycleOrigin,
    formatNumber,
    formatNumberSafe,
    formatPointValues,
    formatPolarValue,
    formatScientific,
    formatTerminationReasonLabel,
    frozenVariableDrafts,
    frozenVariableHeaderNames,
    handleClearParamOverride,
    handleClvColorChange,
    handleClvVisibilityChange,
    handleComputeCovariant,
    handleComputeIsocline,
    handleComputeLimitCycleFloquetModes,
    handleComputeLyapunov,
    handleCreateBranchFromPoint,
    handleCreateCodim2Branch,
    onComputeNormalFormAtPoint,
    onCreateCodim2BranchFromPoint,
    onCreatePeriodicBranchFromPoint,
    handleCreateCycleFromPD,
    handleCreateEquilibriumBranch,
    handleCreateEquilibriumManifold,
    handleCreateFoldCurve,
    handleCreateHomoclinicFromHomoclinic,
    handleCreateHomoclinicFromHomotopySaddle,
    handleCreateHomoclinicFromLargeCycle,
    handleCreateHomotopySaddleFromEquilibrium,
    handleCreateHopfCurve,
    handleCreateIsoperiodicCurve,
    handleCreateLimitCycleCodim1Curve,
    handleCreateLimitCycleFromHopf,
    handleCreateLimitCycleFromOrbit,
    handleCreateLimitCycleFromPD,
    handleCreateLimitCycleManifold,
    handleCreateNSCurve,
    handleEquilibriumEigenvectorColorChange,
    handleEquilibriumEigenvectorVisibilityChange,
    handleExtendBranch,
    handleExtendEquilibriumManifold1D,
    handleExtendManifold2D,
    handleFrozenVariableValueChange,
    handleJumpToBranchPoint,
    handleLimitCycleFloquetColorChange,
    handleLimitCycleFloquetVisibilityChange,
    handleLimitCyclePreviewJump,
    handleOrbitPreviewJump,
    handleParamOverrideChange,
    handlePasteEquilibriumGuess,
    handlePasteOrbitState,
    handlePasteParamOverride,
    handleRunOrbit,
    handleSolveEquilibrium,
    handleToggleFrozenVariable,
    handleToggleIsoclineAxis,
    handleUpdateIsocline,
    handleUpdateIsoclineAxisField,
    handleUpdateIsoclineFrozenValue,
    hasParamOverride,
    homoclinicFromHomoclinicDraft,
    homoclinicFromHomoclinicError,
    homoclinicFromHomotopySaddleDraft,
    homoclinicFromHomotopySaddleError,
    homoclinicFromLargeCycleDraft,
    homoclinicFromLargeCycleError,
    homotopyBranchStage,
    homotopySaddleFromEquilibriumDraft,
    homotopySaddleFromEquilibriumError,
    homotopyStageDReady,
    hopfCurveDraft,
    hopfCurveError,
    hopfCurveLabel,
    hopfOmega,
    isBranchRenderTarget,
    isDiscreteMap,
    isHopfPointSelected,
    isHopfSourceBranch,
    isLimitCycleBranch,
    isMapSystem,
    isRealEigenvalue,
    isStoredCycleTarget,
    isSurfaceManifoldBranch,
    isoperiodicCurveDraft,
    isoperiodicCurveError,
    isoperiodicParam1Options,
    isoperiodicParam2Options,
    isocline,
    isoclineActiveAxes,
    isoclineActiveSet,
    isoclineAxisDrafts,
    isoclineComputing,
    isoclineError,
    isoclineFrozenDrafts,
    isoclineFrozenVariables,
    isoclineLevelDraft,
    isoclineMaxActiveVariables,
    isoclineResolvedExpression,
    isoclineSourceKind,
    isoclineSourceVariable,
    isoclineStale,
    kaplanYorkeDimension,
    limitCycle,
    limitCycleCodim1Curve,
    limitCycleCodim1CurveOptions,
    limitCycleCodim1CurveDraft,
    limitCycleCodim1CurveError,
    limitCycleDisplayMultipliers,
    limitCycleDisplayParamValue,
    limitCycleDisplayParams,
    limitCycleFloquetColors,
    limitCycleFloquetBackend,
    limitCycleFloquetIndices,
    limitCycleFloquetModePointCount,
    limitCycleFloquetModes,
    limitCycleFloquetModesAvailable,
    limitCycleFloquetModesError,
    limitCycleFloquetModesMatchMesh,
    limitCycleFloquetRender,
    limitCycleFloquetVisibleSet,
    setLimitCycleFloquetBackend,
    limitCycleFromHopfBranchSuggestion,
    limitCycleFromHopfDraft,
    limitCycleFromHopfError,
    limitCycleFromOrbitBranchSuggestion,
    limitCycleFromOrbitDraft,
    limitCycleFromOrbitError,
    limitCycleFromOrbitNameSuggestion,
    limitCycleFromPDBranchSuggestion,
    limitCycleFromPDDraft,
    limitCycleFromPDError,
    limitCycleFromPDLabel,
    limitCycleFromPDNameSuggestion,
    limitCycleManifoldDraft,
    limitCycleManifoldEligibleFloquetIndexOptions,
    limitCycleManifoldError,
    limitCycleMesh,
    limitCycleModeMultipliers,
    limitCycleMultiplierPlot,
    limitCycleParentId,
    limitCyclePointMetrics,
    limitCyclePreviewEnd,
    limitCyclePreviewError,
    limitCyclePreviewInput,
    limitCyclePreviewPage,
    limitCyclePreviewPageCount,
    limitCyclePreviewRows,
    limitCyclePreviewStart,
    limitCyclePreviewVarNames,
    limitCycleProfilePoints,
    limitCycleRenderLabel,
    limitCycleRenderableMultipliers,
    lyapunovDimension,
    lyapunovDraft,
    lyapunovError,
    makeSurfaceProfileDefaults,
    manifoldCurveSolverDiagnostics,
    manifoldSolverDiagnostics,
    manifoldSurfaceGeometry,
    manifoldSurfaceRingCount,
    manifoldSurfaceVertexCount,
    manifoldSurfaceVisible,
    maxSceneAxes,
    nodeRender,
    nodeVisibility,
    nsCurveDraft,
    nsCurveError,
    nsCurveLabel,
    object,
    onLimitCyclePointSelect,
    onOrbitPointSelect,
    onSetLimitCycleRenderTarget,
    onToggleVisibility,
    onUpdateAnalysisViewport,
    onUpdateBifurcationDiagram,
    onUpdateRender,
    onUpdateScene,
    onValidateAnalysisExpression,
    orbit,
    orbitDraft,
    orbitError,
    orbitPreviewEnd,
    orbitPreviewError,
    orbitPreviewInput,
    orbitPreviewPage,
    orbitPreviewPageCount,
    orbitPreviewRows,
    orbitPreviewStart,
    orbitPreviewVarNames,
    paramOverrideDraft,
    paramOverrideError,
    paramOverrideTarget,
    paramOverrideTitle,
    parseAxisValue,
    parseDraftNumber,
    parseInteger,
    parseNumber,
    pdObjectLabel,
    pdObjectLabelName,
    runDisabled,
    scene,
    sceneAxisSelection,
    sceneFilteredEntries,
    sceneSearch,
    sceneSelectedEntries,
    sceneSelectedIds,
    sceneSelectedSet,
    selectedBranchPoint,
    selectedBranchPointParameterReadout,
    selectedBranchPointParams,
    selectedBranchPointState,
    selectedLimitCyclePoint,
    selectedLimitCyclePointIndex,
    selectedNodeId,
    selectedOrbitPoint,
    selectedOrbitPointIndex,
    selectedOrbitState,
    selectionKey,
    selectionNameDraft,
    selectionNode,
    selectionPayloadPending,
    selectionTypeLabel,
    setBranchContinuationDraft,
    setBranchExtensionDraft,
    setBranchNavigatorOpen,
    setBranchPoint,
    setBranchPointInput,
    setContinuationDraft,
    setCovariantDraft,
    setDiagramSearch,
    setEquilibriumDraft,
    setEquilibriumManifoldDraft,
    setEquilibriumManifoldExtensionDraft,
    setFoldCurveDraft,
    setHomoclinicFromHomoclinicDraft,
    setHomoclinicFromHomotopySaddleDraft,
    setHomoclinicFromLargeCycleDraft,
    setHomotopySaddleFromEquilibriumDraft,
    setHopfCurveDraft,
    setIsoperiodicCurveDraft,
    setIsoclineError,
    setIsoclineLevelDraft,
    setLimitCycleFromHopfDraft,
    setLimitCycleCodim1CurveDraft,
    setLimitCycleCodim1CurveTarget,
    setLimitCycleFromOrbitDraft,
    setLimitCycleFromPDDraft,
    setLimitCycleManifoldDraft,
    setLimitCyclePreviewError,
    setLimitCyclePreviewInput,
    setLimitCyclePreviewPageIndex,
    setLyapunovDraft,
    setNSCurveDraft,
    setOrbitDraft,
    setOrbitPreviewError,
    setOrbitPreviewInput,
    setOrbitPreviewPageIndex,
    setSceneSearch,
    setSelectionNameDraft,
    showBranchContinueFromPoint,
    showCodim1CurveContinuations,
    showEquilibriumEigenvectorControls,
    showFoldCurveContinuation,
    showHomoclinicFromHomoclinic,
    showHomoclinicFromHomotopySaddle,
    showHomoclinicFromLargeCycle,
    showHomotopySaddleFromEquilibrium,
    showHopfCurveContinuation,
    showIsoperiodicContinuation,
    showLimitCycleFromHopf,
    showLimitCycleCodim1CurveContinuation,
    showLimitCycleFromPD,
    showNSCurveContinuation,
    showSceneAxisPicker,
    showVisibilityToggle,
    subsystemSnapshotMismatch,
    suggestDefaultName,
    summary,
    supportsManifoldSurfaceToggle,
    supportsStateSpaceStride,
    system,
    systemDraft,
    updateClvRender,
    updateEquilibriumEigenvectorRender,
    updateLimitCycleFloquetRender,
    updateSceneAxisCount,
    updateSceneAxisVariable,
    workflowActions,
    workflowFocus,
    writeClipboardText,
  }

}
