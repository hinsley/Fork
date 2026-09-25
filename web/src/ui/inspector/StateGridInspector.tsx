import { useEffect, useMemo, useRef, useState } from 'react'
import type { Data, Layout } from 'plotly.js'
import type { StateGridObject, System, TreeNode } from '../../system/types'
import type { StateGridComputeRequest } from '../../state/appState'
import { PlotlyViewport } from '../../viewports/plotly/PlotlyViewport'
import { OpacityPercentInput } from '../OpacityPercentInput'
import { resolveObjectParams } from '../../system/parameters'
import { buildSubsystemSnapshot } from '../../system/subsystemGateway'
import { autonomousContextError } from '../../system/expressionContext'
import {
  applyPointValues,
  formatPointValues,
  parsePointValues,
  readClipboardText,
  writeClipboardText,
} from './stateTableValues'
import { StateTable } from './StateTable'
import {
  InspectorDisclosure,
  WorkflowFocusToolbar,
} from './selectionSession'
import {
  ActionBar,
  EntityHeader,
  KeyValues,
  SnowflakeIcon,
  type HeaderPanel,
} from './InspectorChrome'
import { Icon } from '../Icon'
import { fmt, fmtCount } from '../../utils/format'
import { useWorkflowFocus } from './useWorkflowFocus'
import type { WorkflowActionEntry } from './selectionSessionState'

type StateGridInspectorProps = {
  system: System
  nodeId: string
  object: StateGridObject
  onCreateParticles?: (id: string) => void
  onRename: (id: string, name: string) => void
  onUpdate: (
    id: string,
    update: Partial<Omit<StateGridObject, 'type' | 'name' | 'systemName'>>
  ) => void
  onCompute: (
    request: StateGridComputeRequest,
    opts?: { signal?: AbortSignal }
  ) => Promise<unknown>
  onUpdateObjectParams?: (id: string, params: number[] | null) => void
  onUpdateObjectFrozenVariables?: (
    id: string,
    frozenValuesByVarName: Record<string, number>
  ) => void
  onToggleVisibility?: (id: string) => void
  onUpdateRender?: (id: string, render: Partial<TreeNode['render']>) => void
  onComputeTransferOperator?: (request: StateGridComputeRequest, opts?: { signal?: AbortSignal }) => Promise<unknown>
}

type StateGridAxisDraft = {
  min: string
  max: string
  resolution: string
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

function buildStateGridAxisDrafts(
  axes: StateGridObject['axes']
): Record<string, StateGridAxisDraft> {
  const drafts: Record<string, StateGridAxisDraft> = {}
  for (const axis of axes) {
    drafts[axis.variableName] = {
      min: axis.min.toString(),
      max: axis.max.toString(),
      resolution: axis.resolution.toString(),
    }
  }
  return drafts
}

function formatCount(value: number): string {
  return Number.isSafeInteger(value) ? value.toLocaleString() : 'Too large to represent safely'
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function StateGridInspector({
  system,
  nodeId,
  object,
  onCreateParticles,
  onRename,
  onUpdate,
  onCompute,
  onUpdateObjectParams = () => {},
  onUpdateObjectFrozenVariables = () => {},
  onToggleVisibility = () => {},
  onUpdateRender = () => {},
  onComputeTransferOperator,
}: StateGridInspectorProps) {
  const workflowFocus = useWorkflowFocus()
  const [nameDraft, setNameDraft] = useState(object.name)
  const [axisDrafts, setAxisDrafts] = useState<Record<string, StateGridAxisDraft>>(
    () => buildStateGridAxisDrafts(object.axes)
  )
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  useEffect(() => {
    setAxisDrafts((previous) => {
      const next: Record<string, StateGridAxisDraft> = {}
      for (const axis of object.axes) {
        const current = previous[axis.variableName]
        next[axis.variableName] = {
          min: current?.min ?? axis.min.toString(),
          max: current?.max ?? axis.max.toString(),
          resolution: current?.resolution ?? axis.resolution.toString(),
        }
      }
      return next
    })
  }, [object.axes])
  const isMap = system.config.type === 'map'
  const isFlow = system.config.type === 'flow'
  const transferSolverSupported = isMap
    ? system.config.solver === 'discrete'
    : system.config.solver === 'rk4' || system.config.solver === 'tsit5'
  const transferContextError = isFlow
    ? autonomousContextError(system.config, object.frozenVariables?.frozenEquationContext)
    : null
  const transferEnabled = transferSolverSupported && !transferContextError
  const frozenValues = object.frozenVariables?.frozenValuesByVarName ?? {}
  const resolvedParameters = resolveObjectParams(system.config, object.customParameters)
  const subsystemSnapshot = buildSubsystemSnapshot(system.config, object.frozenVariables)
  const freeVariableNames = new Set(subsystemSnapshot.freeVariableNames)
  const freeAxes = subsystemSnapshot.freeVariableNames.flatMap((variableName) => {
    const axis = object.axes.find((candidate) => candidate.variableName === variableName)
    return axis ? [axis] : []
  })
  const totalPoints = object.axes
    .filter((axis) => freeVariableNames.has(axis.variableName))
    .reduce((total, axis) => {
      if (!Number.isSafeInteger(total) || !Number.isInteger(axis.resolution)) {
        return Number.POSITIVE_INFINITY
      }
      const next = total * axis.resolution
      return Number.isSafeInteger(next) ? next : Number.POSITIVE_INFINITY
    }, 1)
  const integrationWork = totalPoints * object.analysis.steps
  const workloadLevel =
    !Number.isFinite(totalPoints) || totalPoints >= 100_000
      ? 'large'
      : totalPoints >= 10_000
        ? 'moderate'
        : 'small'
  const result = object.lastResult
  const node = system.nodes[nodeId]
  const resultStale = Boolean(
    result &&
      (!sameJson(result.axes, object.axes) ||
        !sameJson(result.settings, object.analysis) ||
        !sameJson(result.parameters, resolvedParameters) ||
        (result.subsystemSnapshot
          ? result.subsystemSnapshot.hash !== subsystemSnapshot.hash
          : Object.keys(frozenValues).length > 0) ||
        result.dynamicsType !== system.config.type)
  )
  const transferUnavailableReason = transferContextError
    ? 'Invariant measures are not implemented for non-autonomous flows yet.'
    : transferSolverSupported
      ? null
      : isFlow
        ? 'Invariant measures require the RK4 or Tsit5 flow solver.'
        : 'Invariant measures require the discrete map solver.'
  const workflowActions: WorkflowActionEntry[] = [
    ...((isMap || isFlow)
      ? [{
          id: 'state-grid-transfer-toggle' as const,
          group: 'Compute' as const,
          label: 'Invariant measure',
          description: transferUnavailableReason ??
            (isFlow
              ? 'Compute the conditional operator of a fixed sampled flow map.'
              : 'Compute the conditional State Grid transfer operator.'),
          disabled: !transferEnabled,
          primary: true,
        }]
      : []),
    {
      id: 'state-grid-entropy-toggle',
      group: 'Compute',
      label: 'Entropy',
      title: 'Expansion entropy',
      description: 'Configure and run the finite-region expansion-entropy calculation.',
      primary: true,
    },
    ...(isFlow ? [{ id: 'state-grid-particles-toggle' as const, group: 'Compute' as const,
      label: 'Particles', description: 'Animate particles inside this grid.', primary: true }] : []),
    {
      id: 'state-grid-setup-toggle',
      group: 'Configure',
      label: 'Grid setup',
      description: 'Set bounds and resolution for the free state variables.',
    },
  ]
  const storedTransferSettings = object.transferOperator?.settings
  const legacyFlowSettings =
    isFlow &&
    storedTransferSettings !== undefined &&
    storedTransferSettings.integrationStep === undefined
  const transferSettings = {
    samplesPerCell: 4,
    iterations: 1,
    maxStationaryIterations: 2000,
    tolerance: 1e-10,
    outsidePolicy: 'conditional_in_grid' as const,
    startingPoint: Object.fromEntries(
      freeAxes.map((axis) => [axis.variableName, (axis.min + axis.max) / 2])
    ),
    ...storedTransferSettings,
    timeStep: isMap
      ? storedTransferSettings?.timeStep ?? 1
      : legacyFlowSettings
        ? 1
        : storedTransferSettings?.timeStep ?? 1,
    integrationStep: isMap
      ? 1
      : legacyFlowSettings
        ? storedTransferSettings?.timeStep ?? object.analysis.dt
        : storedTransferSettings?.integrationStep ?? object.analysis.dt,
  }
  const resolvedStartingPoint = Object.fromEntries(
    freeAxes.map((axis) => [
      axis.variableName,
      transferSettings.startingPoint?.[axis.variableName] ?? (axis.min + axis.max) / 2,
    ])
  )
  const startingPointKey = JSON.stringify(
    freeAxes.map((axis) => [axis.variableName, resolvedStartingPoint[axis.variableName]])
  )
  const [startingPointDraft, setStartingPointDraft] = useState<string[]>(() =>
    freeAxes.map((axis) => resolvedStartingPoint[axis.variableName].toString())
  )
  useEffect(() => {
    setStartingPointDraft(
      freeAxes.map((axis) => resolvedStartingPoint[axis.variableName].toString())
    )
    // The serialized key changes only when the free axes or persisted point changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startingPointKey])
  const updateStartingPoint = (next: string[]) => {
    setStartingPointDraft(next)
    const values = next.map(parseDraftNumber)
    if (values.some((value) => value === null)) return
    onUpdate(nodeId, {
      transferOperator: {
        settings: {
          ...transferSettings,
          startingPoint: Object.fromEntries(
            freeAxes.map((axis, index) => [axis.variableName, values[index] as number])
          ),
        },
      },
    })
  }
  const updateTransferSettings = (
    field: 'samplesPerCell' | 'iterations' | 'timeStep' | 'integrationStep' | 'maxStationaryIterations' | 'tolerance',
    rawValue: string
  ) => {
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value <= 0) return
    if (
      field !== 'tolerance' &&
      field !== 'timeStep' &&
      field !== 'integrationStep' &&
      !Number.isInteger(value)
    ) return
    onUpdate(nodeId, {
      transferOperator: {
        settings: { ...transferSettings, [field]: value },
      },
    })
  }
  const runTransferOperator = async () => {
    if (!onComputeTransferOperator) return
    setError(null)
    const startingPointValues = freeAxes.map((axis, index) => {
      const value = parseDraftNumber(startingPointDraft[index] ?? '')
      if (value === null) {
        setError(`Starting point for "${axis.variableName}" must be a finite number.`)
        return null
      }
      if (value < axis.min || value > axis.max) {
        setError(`Starting point for "${axis.variableName}" must be within the State Grid bounds.`)
        return null
      }
      return value
    })
    if (startingPointValues.some((value) => value === null)) return
    const startingPoint = Object.fromEntries(
      freeAxes.map((axis, index) => [axis.variableName, startingPointValues[index] as number])
    )
    const controller = new AbortController()
    controllerRef.current = controller
    setRunning(true)
    try {
      await onComputeTransferOperator(
        { stateGridId: nodeId, startingPoint },
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
  const finalEstimate = result?.entropyEstimates.at(-1)
  const plot = useMemo(() => {
    if (!result || result.checkpoints.length === 0) return null
    const iterationResult = result.horizonKind === 'iteration'
    const data: Data[] = [
      {
        type: 'scatter',
        mode: 'lines+markers',
        x: result.checkpoints,
        y: result.entropyEstimates,
        name: iterationResult ? 'h(n)' : 'h(T)',
        line: { color: '#e06c3f', width: 2 },
        marker: { size: 5 },
      },
    ]
    const layout: Partial<Layout> = {
      margin: { l: 55, r: 15, t: 15, b: 45 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      xaxis: {
        title: { text: iterationResult ? 'Iteration n' : 'Time T' },
        automargin: true,
      },
      yaxis: {
        title: {
          text: iterationResult
            ? 'Finite-iteration estimate h(n)'
            : 'Finite-time estimate h(T)',
        },
        automargin: true,
      },
      showlegend: false,
      height: 260,
    }
    return { data, layout }
  }, [result])

  const updateAxis = (
    index: number,
    field: 'min' | 'max' | 'resolution',
    rawValue: string
  ) => {
    const axis = object.axes[index]
    if (!axis) return
    setAxisDrafts((previous) => {
      const current = previous[axis.variableName] ?? {
        min: axis.min.toString(),
        max: axis.max.toString(),
        resolution: axis.resolution.toString(),
      }
      return {
        ...previous,
        [axis.variableName]: { ...current, [field]: rawValue },
      }
    })
    const value = field === 'resolution'
      ? parseDraftInteger(rawValue)
      : parseDraftNumber(rawValue)
    if (value === null) return
    if (field === 'resolution' && value < 1) return
    const axes = object.axes.map((axis, axisIndex) =>
      axisIndex === index ? { ...axis, [field]: value } : axis
    )
    onUpdate(nodeId, { axes })
  }

  const updateAnalysis = (
    field: 'steps' | 'dt' | 'checkpointStride' | 'stabilizationStride',
    rawValue: string
  ) => {
    const value = Number(rawValue)
    if (!Number.isFinite(value) || value <= 0) return
    if (field !== 'dt' && !Number.isInteger(value)) return
    onUpdate(nodeId, { analysis: { ...object.analysis, [field]: value } })
  }

  const run = async () => {
    setError(null)
    const committedAxes = object.axes.map((axis) => {
      const draft = axisDrafts[axis.variableName]
      const min = parseDraftNumber(draft?.min ?? axis.min.toString())
      const max = parseDraftNumber(draft?.max ?? axis.max.toString())
      const resolution = parseDraftInteger(draft?.resolution ?? axis.resolution.toString())
      return { axis, min, max, resolution }
    })
    for (const { axis, min, max, resolution } of committedAxes) {
      if (min === null) {
        setError(`State Grid min for "${axis.variableName}" must be a finite number.`)
        return
      }
      if (max === null) {
        setError(`State Grid max for "${axis.variableName}" must be a finite number.`)
        return
      }
      if (resolution === null || resolution < 1) {
        setError(
          `State Grid resolution for "${axis.variableName}" must be a positive integer.`
        )
        return
      }
      if (min > max || (min === max && resolution !== 1)) {
        setError(
          `Bounds for ${axis.variableName} require min < max, or min = max with resolution 1.`
        )
        return
      }
    }
    const nextAxes = committedAxes.map(({ axis, min, max, resolution }) => ({
      ...axis,
      min: min as number,
      max: max as number,
      resolution: resolution as number,
    }))
    if (!sameJson(nextAxes, object.axes)) {
      onUpdate(nodeId, { axes: nextAxes })
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setRunning(true)
    try {
      await onCompute({ stateGridId: nodeId }, { signal: controller.signal })
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === 'AbortError')) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null
      setRunning(false)
    }
  }

  const navigationClass =
    workflowFocus?.navigationPhase !== 'idle' && workflowFocus?.navigationDirection
      ? ` inspector-navigation-page--${workflowFocus.navigationPhase}-${workflowFocus.navigationDirection}`
      : ''
  const actionOnly = Boolean(workflowFocus)
  const frozenCount = Object.keys(frozenValues).length

  const appearanceContent = node ? (
    <div className="inspector-section" data-testid="appearance-section">
      <div className="inspector-form-grid">
        <label>
          Color
          <input
            type="color"
            value={node.render.color}
            onChange={(event) => onUpdateRender(nodeId, { color: event.target.value })}
            data-testid="inspector-color"
          />
        </label>
        <label>
          Opacity %
          <OpacityPercentInput
            value={node.render.opacity}
            onChange={(opacity) => onUpdateRender(nodeId, { opacity })}
            ariaLabel="Color opacity percentage"
            testId="inspector-color-opacity"
          />
        </label>
        <label>
          Point size
          <input
            type="number"
            min={2}
            max={12}
            value={node.render.pointSize}
            onChange={(event) =>
              onUpdateRender(nodeId, { pointSize: Number(event.target.value) })
            }
            data-testid="inspector-point-size"
          />
        </label>
      </div>
    </div>
  ) : null

  const frozenContent = (
    <section className="inspector-section" data-testid="frozen-variables-section">
      <table className="data-table inspector-frozen-table" aria-label="Frozen variables">
        <thead>
          <tr>
            <th>Variable</th>
            <th>Frozen</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {system.config.varNames.map((variableName) => {
            const isFrozen = Object.prototype.hasOwnProperty.call(frozenValues, variableName)
            return (
              <tr key={variableName}>
                <td>{variableName}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={isFrozen}
                    disabled={!isFrozen && freeVariableNames.size <= 1}
                    onChange={(event) => {
                      const next = { ...frozenValues }
                      if (event.target.checked) next[variableName] = 0
                      else delete next[variableName]
                      onUpdateObjectFrozenVariables(nodeId, next)
                    }}
                    data-testid={`frozen-variable-toggle-${variableName}`}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="state-table__input"
                    value={frozenValues[variableName] ?? 0}
                    disabled={!isFrozen}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (!Number.isFinite(value)) return
                      onUpdateObjectFrozenVariables(nodeId, {
                        ...frozenValues,
                        [variableName]: value,
                      })
                    }}
                    data-testid={`frozen-variable-value-${variableName}`}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )

  const parametersContent = (
    <section className="inspector-section" data-testid="param-override-section">
      {system.config.paramNames.length > 0 ? (
        <div className="inspector-form-grid">
          {system.config.paramNames.map((parameterName, index) => (
            <label key={parameterName}>
              {parameterName}
              <input
                type="number"
                value={resolvedParameters[index] ?? 0}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  if (!Number.isFinite(value)) return
                  const next = [...resolvedParameters]
                  next[index] = value
                  onUpdateObjectParams(nodeId, next)
                }}
                data-testid={`param-override-${parameterName}`}
              />
            </label>
          ))}
        </div>
      ) : (
        <p className="faint">—</p>
      )}
      {object.customParameters ? (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => onUpdateObjectParams(nodeId, null)}
          data-testid="param-override-clear"
        >
          Restore defaults
        </button>
      ) : null}
    </section>
  )

  const headerPanels: HeaderPanel[] = [
    ...(appearanceContent
      ? [{
          id: 'appearance' as const,
          label: 'Appearance',
          icon: (
            <span className="inspector-swatch-icon">
              <Icon name="palette" />
              <span
                className="inspector-swatch-icon__dot"
                style={{ background: node?.render.color }}
                aria-hidden="true"
              />
            </span>
          ),
          content: appearanceContent,
        }]
      : []),
    {
      id: 'parameters',
      label: object.customParameters ? 'Parameters (custom)' : 'Parameters',
      icon: <Icon name="sliders" />,
      highlighted: Boolean(object.customParameters),
      badge: object.customParameters ? 'p' : undefined,
      content: parametersContent,
    },
    {
      id: 'frozen-variables',
      label: 'Frozen variables',
      icon: <SnowflakeIcon />,
      highlighted: frozenCount > 0,
      badge: frozenCount > 0 ? frozenCount : undefined,
      content: frozenContent,
    },
  ]

  const summaryRows = (
    <div className="inspector-glance" data-testid="state-grid-summary">
      <KeyValues
        rows={freeAxes.map((axis) => ({
          label: axis.variableName,
          value: `[${fmt(axis.min)}, ${fmt(axis.max)}] × ${fmtCount(axis.resolution)}`,
        }))}
      />
      <KeyValues
        columns={2}
        testId="state-grid-workload"
        rows={[
          {
            label: 'Points',
            value: (
              <>
                <span data-testid="state-grid-total-points">{formatCount(totalPoints)}</span>
                {workloadLevel !== 'small' ? (
                  <span
                    className={`chip ${workloadLevel === 'large' ? 'chip--unstable' : 'chip--warning'}`}
                    title="Runtime and memory grow with the Cartesian product of resolutions"
                    data-testid="state-grid-workload-warning"
                  >
                    {workloadLevel}
                  </span>
                ) : null}
              </>
            ),
          },
          {
            label: 'Work',
            value: formatCount(integrationWork),
            title: isMap ? 'Map/tangent iterations' : 'Forward/tangent steps',
          },
          result
            ? {
                label: result.horizonKind === 'iteration' ? 'h(n)' : 'h(T)',
                value: (
                  <>
                    {typeof finalEstimate === 'number' && Number.isFinite(finalEstimate)
                      ? fmt(finalEstimate)
                      : '−∞'}
                    {resultStale ? <span className="chip chip--warning">stale</span> : null}
                  </>
                ),
                title: 'Last expansion-entropy estimate',
              }
            : null,
        ]}
      />
    </div>
  )

  return (
    <div
      className={`inspector-panel inspector-browser${workflowFocus?.activeWorkflow ? ' inspector-browser--workflow' : ''}`}
      data-testid="state-grid-inspector"
      data-active-workflow={workflowFocus?.activeWorkflow ?? undefined}
      data-navigation-direction={workflowFocus?.navigationDirection ?? undefined}
      data-navigation-phase={workflowFocus?.navigationPhase ?? 'idle'}
    >
      <div
        className={`inspector-group inspector-navigation-page${navigationClass}`}
        key={workflowFocus?.activeWorkflow ?? 'state-grid-root'}
      >
        <EntityHeader
          name={nameDraft}
          onNameChange={setNameDraft}
          onNameCommit={() => {
            const trimmed = nameDraft.trim()
            if (trimmed && trimmed !== object.name) onRename(nodeId, trimmed)
          }}
          onNameCancel={() => setNameDraft(object.name)}
          typeLabel="State grid"
          chip={{ label: isMap ? 'map' : 'flow', tone: 'neutral', title: 'State grid' }}
          detail={[`${freeAxes.length}D grid`]}
          visible={node?.visibility ?? true}
          onToggleVisibility={node ? () => onToggleVisibility(nodeId) : undefined}
          panels={headerPanels}
        />

        {summaryRows}

        <WorkflowFocusToolbar entries={workflowActions} />
        <ActionBar entries={workflowActions} />

        <InspectorDisclosure
          title="Grid setup"
          testId="state-grid-setup-toggle"
          actionOnly={actionOnly}
          defaultOpen={!workflowFocus}
        >
          <section className="inspector-section">
            <div
              className="state-grid-axis-table"
              role="table"
              aria-label="Bounds and resolution"
            >
              <div className="state-grid-axis-table__header" role="row">
                <span role="columnheader">Variable</span>
                <span role="columnheader">Min</span>
                <span role="columnheader">Max</span>
                <span role="columnheader">Resolution</span>
              </div>
              {object.axes.map((axis, index) => freeVariableNames.has(axis.variableName) ? (
                <div
                  className="state-grid-axis-table__row"
                  role="row"
                  key={axis.variableName}
                >
                  <strong role="cell">{axis.variableName}</strong>
                  <span role="cell">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`${axis.variableName} minimum`}
                      value={axisDrafts[axis.variableName]?.min ?? axis.min.toString()}
                      onChange={(event) => updateAxis(index, 'min', event.target.value)}
                      data-testid={`state-grid-${axis.variableName}-min`}
                    />
                  </span>
                  <span role="cell">
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`${axis.variableName} maximum`}
                      value={axisDrafts[axis.variableName]?.max ?? axis.max.toString()}
                      onChange={(event) => updateAxis(index, 'max', event.target.value)}
                      data-testid={`state-grid-${axis.variableName}-max`}
                    />
                  </span>
                  <span role="cell">
                    <input
                      type="text"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      aria-label={`${axis.variableName} resolution`}
                      value={axisDrafts[axis.variableName]?.resolution ?? axis.resolution.toString()}
                      onChange={(event) => updateAxis(index, 'resolution', event.target.value)}
                      data-testid={`state-grid-${axis.variableName}-resolution`}
                    />
                  </span>
                </div>
              ) : null)}
            </div>
          </section>
        </InspectorDisclosure>

        {isFlow ? <InspectorDisclosure title="Particles" testId="state-grid-particles-toggle"
          actionOnly={actionOnly} defaultOpen={!workflowFocus}>
          <section className="inspector-section">
            <button className="inspector-primary-action" type="button"
              disabled={!onCreateParticles} onClick={() => onCreateParticles?.(nodeId)}
              title="Particles inherit this grid's bounds, parameters, and frozen variables"
              data-testid="state-grid-create-particles">Create</button>
          </section>
        </InspectorDisclosure> : null}

        <InspectorDisclosure
          title="Expansion entropy"
          testId="state-grid-entropy-toggle"
          actionOnly={actionOnly}
          defaultOpen={!workflowFocus}
        >
          <section
            className="inspector-section"
            title={
              isMap
                ? 'Hunt–Ott estimate restricted to this region, iteration horizon, and grid. Escaped trajectories contribute zero.'
                : 'Hunt–Ott estimate restricted to this region, time horizon, and grid. Escaped trajectories contribute zero.'
            }
          >
            <label>
              {isMap ? 'Iterations' : 'Steps'}
              <input
                type="number"
                min={1}
                step={1}
                value={object.analysis.steps}
                onChange={(event) => updateAnalysis('steps', event.target.value)}
                data-testid="state-grid-entropy-steps"
              />
            </label>
            {!isMap ? (
              <label>
                dt
                <input
                  type="number"
                  min="0"
                  value={object.analysis.dt}
                  onChange={(event) => updateAnalysis('dt', event.target.value)}
                  data-testid="state-grid-entropy-dt"
                />
              </label>
            ) : null}
            <label title="Convergence checkpoint stride">
              Checkpoints
              <input
                type="number"
                min={1}
                step={1}
                value={object.analysis.checkpointStride}
                onChange={(event) => updateAnalysis('checkpointStride', event.target.value)}
                data-testid="state-grid-entropy-checkpoint-stride"
              />
            </label>
            <label title="Tangent stabilization stride">
              Stabilization
              <input
                type="number"
                min={1}
                step={1}
                value={object.analysis.stabilizationStride}
                onChange={(event) => updateAnalysis('stabilizationStride', event.target.value)}
                data-testid="state-grid-entropy-stabilization-stride"
              />
            </label>
            {error ? <p className="inspector-error">{error}</p> : null}
            <div className="inspector-submit-row">
              <button
                className="inspector-primary-action"
                type="button"
                onClick={() => void run()}
                disabled={running || !Number.isFinite(totalPoints)}
                data-testid="state-grid-run-expansion-entropy"
              >
                {running ? 'Computing…' : 'Compute'}
              </button>
              {running ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => controllerRef.current?.abort()}
                  data-testid="state-grid-cancel-expansion-entropy"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </section>

          <section className="inspector-section" data-testid="state-grid-expansion-entropy-result">
            <h4 className="section-head">
              <span>Result</span>
              {result && resultStale ? (
                <span className="chip chip--warning" title="Grid or system parameters changed">
                  stale
                </span>
              ) : null}
            </h4>
            {result ? (
              <>
                <KeyValues
                  columns={2}
                  rows={[
                    {
                      label: result.horizonKind === 'iteration' ? 'h(n)' : 'h(T)',
                      value: (
                        <span data-testid="state-grid-final-estimate">
                          {typeof finalEstimate === 'number' && Number.isFinite(finalEstimate)
                            ? fmt(finalEstimate)
                            : '−∞'}
                        </span>
                      ),
                    },
                    {
                      label: 'Survivors',
                      value: `${fmtCount(result.survivorCounts.at(-1) ?? 0)} / ${fmtCount(result.totalSamples)}`,
                    },
                    result.executionMode
                      ? {
                          label: 'Runtime',
                          value:
                            result.executionMode === 'parallel'
                              ? `${result.workerCount ?? 1} workers`
                              : 'serial',
                          title: 'Rust/WASM execution',
                        }
                      : null,
                  ]}
                />
                {result.conditioningWarning ? (
                  <p className="inspector-error">
                    Tangent conditioning overflowed; shorten the horizon or stabilization stride.
                  </p>
                ) : null}
                {plot ? (
                  <div className="inspector-plot">
                    <PlotlyViewport
                      plotId={`state-grid-expansion-entropy-${nodeId}`}
                      data={plot.data}
                      layout={plot.layout}
                      testId="state-grid-expansion-entropy-plot"
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="faint">—</p>
            )}
          </section>
        </InspectorDisclosure>

        {transferEnabled ? (
        <InspectorDisclosure
          title="Invariant measure"
          testId="state-grid-transfer-toggle"
          actionOnly={actionOnly}
          defaultOpen={!workflowFocus}
        >
          <section className="inspector-section" data-testid="state-grid-invariant-measure-workflow">
          <StateTable
            title="Starting point"
            varNames={freeAxes.map((axis) => axis.variableName)}
            values={startingPointDraft}
            onChange={updateStartingPoint}
            onCopy={() => void writeClipboardText(formatPointValues(startingPointDraft))}
            onPaste={() => {
              void (async () => {
                const text = await readClipboardText()
                if (text === null) return
                updateStartingPoint(
                  applyPointValues(
                    startingPointDraft,
                    freeAxes.length,
                    parsePointValues(text)
                  )
                )
              })()
            }}
            testIdPrefix="state-grid-transfer-starting-point"
          />
          <label title="Deterministic samples per cell">
            Samples / cell
            <input
              type="number"
              min={1}
              step={1}
              value={transferSettings.samplesPerCell}
              onChange={(event) =>
                updateTransferSettings('samplesPerCell', event.target.value)
              }
              data-testid="state-grid-transfer-samples-per-cell"
            />
          </label>
          {isMap ? (
            <label title="Map iterations per transition">
              Iterations
              <input
                type="number"
                min={1}
                step={1}
                value={transferSettings.iterations}
                onChange={(event) => updateTransferSettings('iterations', event.target.value)}
                data-testid="state-grid-transfer-iterations"
              />
            </label>
          ) : (
            <label title="Flow-map time per transition (sampled flow map, not a return map)">
              Map time
              <input
                type="number"
                min={0}
                step="any"
                value={transferSettings.timeStep}
                onChange={(event) => updateTransferSettings('timeStep', event.target.value)}
                data-testid="state-grid-transfer-time-step"
              />
            </label>
          )}
          {isFlow ? (
            <label title="Maximum integration step size">
              dt
              <input
                type="number"
                min={0}
                step="any"
                value={transferSettings.integrationStep}
                onChange={(event) => updateTransferSettings('integrationStep', event.target.value)}
                data-testid="state-grid-transfer-integration-step"
              />
            </label>
          ) : null}
          <label title="Stationary iteration limit">
            Max iterations
            <input
              type="number"
              min={1}
              step={1}
              value={transferSettings.maxStationaryIterations}
              onChange={(event) =>
                updateTransferSettings('maxStationaryIterations', event.target.value)
              }
              data-testid="state-grid-transfer-stationary-iterations"
            />
          </label>
          <label title="Convergence tolerance">
            Tolerance
            <input
              type="number"
              min="0"
              value={transferSettings.tolerance}
              onChange={(event) => updateTransferSettings('tolerance', event.target.value)}
              data-testid="state-grid-transfer-tolerance"
            />
          </label>
          {error ? (
            <p className="inspector-error" data-testid="state-grid-transfer-error">
              {error}
            </p>
          ) : null}
          <div className="inspector-submit-row">
            <button
              className="inspector-primary-action"
              type="button"
              onClick={() => void runTransferOperator()}
              disabled={running || !onComputeTransferOperator || !Number.isFinite(totalPoints)}
              data-testid="state-grid-create-invariant-measure"
            >
              {running ? 'Creating…' : 'Create'}
            </button>
            {running ? (
              <button
                type="button"
                className="btn"
                onClick={() => controllerRef.current?.abort()}
                data-testid="state-grid-cancel-invariant-measure"
              >
                Cancel
              </button>
            ) : null}
          </div>
          </section>
        </InspectorDisclosure>
        ) : null}
      </div>
    </div>
  )
}
