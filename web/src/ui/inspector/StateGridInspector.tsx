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
  WorkflowActionList,
  WorkflowFocusToolbar,
} from './selectionSession'
import { useWorkflowFocus } from './useWorkflowFocus'
import type { WorkflowActionEntry } from './selectionSessionState'

type StateGridInspectorProps = {
  system: System
  nodeId: string
  object: StateGridObject
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
  const workflowActions: WorkflowActionEntry[] = [
    {
      id: 'appearance-toggle',
      group: 'Configure',
      label: 'Appearance',
      description: 'Change visibility, color, opacity, and point size.',
    },
    {
      id: 'frozen-variables-toggle',
      group: 'Configure',
      label: 'Frozen Variables',
      description: 'Choose variables to hold constant for this object.',
    },
    {
      id: 'parameters-toggle',
      group: 'Configure',
      label: 'Parameters',
      description: 'Override the system parameter values for this object.',
      tag: object.customParameters ? 'custom' : undefined,
    },
    {
      id: 'state-grid-setup-toggle',
      group: 'Configure',
      label: 'State Grid setup',
      description: 'Set bounds and resolution for the free state variables.',
    },
    ...((isMap || isFlow)
      ? [{
          id: 'state-grid-transfer-toggle' as const,
          group: 'Compute' as const,
          label: 'Invariant measure',
          description: transferContextError
            ? 'Invariant measures are not implemented for non-autonomous flows yet.'
            : transferSolverSupported
              ? isFlow
                ? 'Compute the conditional operator of a fixed sampled flow map.'
                : 'Compute the conditional State Grid transfer operator.'
              : isFlow
                ? 'Invariant measures require the RK4 or Tsit5 flow solver.'
                : 'Invariant measures require the discrete map solver.',
          disabled: !transferEnabled,
        }]
      : []),
    {
      id: 'state-grid-entropy-toggle',
      group: 'Compute',
      label: 'Expansion entropy',
      description: 'Configure and run the finite-region expansion-entropy calculation.',
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
  const workloadSummary = (
    <>
      <div className="inspector-metrics" data-testid="state-grid-workload">
        <div className="inspector-metrics__row">
          <span className="inspector-metrics__label">Total grid points</span>
          <strong className="inspector-metrics__value" data-testid="state-grid-total-points">
            {formatCount(totalPoints)}
          </strong>
        </div>
        <div className="inspector-metrics__row">
          <span className="inspector-metrics__label">
            {isMap ? 'Map/tangent iterations' : 'Forward/tangent steps'}
          </span>
          <span className="inspector-metrics__value">{formatCount(integrationWork)}</span>
        </div>
      </div>
      <p
        className={workloadLevel === 'large' ? 'inspector-error' : 'inspector-help'}
        data-testid="state-grid-workload-warning"
      >
        {workloadLevel === 'large'
          ? 'Large Cartesian product. Runtime and memory pressure grow exponentially with state dimension.'
          : workloadLevel === 'moderate'
            ? 'Moderate Cartesian product. Increasing one resolution multiplies the full workload.'
            : 'The Cartesian product is currently small.'}
      </p>
    </>
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
        {!workflowFocus?.activeWorkflow ? (
          <div className="inspector-section inspector-entity-header">
            <label>
              Name
              <input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onBlur={() => {
                  const trimmed = nameDraft.trim()
                  if (trimmed && trimmed !== object.name) onRename(nodeId, trimmed)
                }}
                data-testid="state-grid-name"
              />
            </label>
            <div className="inspector-meta">
              <span>State Grid</span>
              <span>{isMap ? 'Discrete map' : 'Flow'}</span>
            </div>
          </div>
        ) : null}

        <WorkflowFocusToolbar entries={workflowActions} />
        <WorkflowActionList entries={workflowActions} />

        {node ? (
          <InspectorDisclosure
            title="Appearance"
            testId="appearance-toggle"
            actionOnly={actionOnly}
            defaultOpen={!workflowFocus}
          >
            <div className="inspector-section" data-testid="appearance-section">
              <label>
                Visibility
                <button
                  type="button"
                  onClick={() => onToggleVisibility(nodeId)}
                  data-testid="inspector-visibility"
                >
                  {node.visibility ? 'Visible' : 'Hidden'}
                </button>
              </label>
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
                Opacity (%)
                <OpacityPercentInput
                  value={node.render.opacity}
                  onChange={(opacity) => onUpdateRender(nodeId, { opacity })}
                  ariaLabel="Color opacity percentage"
                  testId="inspector-color-opacity"
                />
              </label>
              <label>
                Point Size
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
          </InspectorDisclosure>
        ) : null}

        {!workflowFocus?.activeWorkflow ? (
          <section className="inspector-section" data-testid="state-grid-summary">
            <h3 className="inspector-subheading">State Grid</h3>
            <p className="inspector-help">
              A bounded regular Cartesian grid in the full state space. Resolution is the number of
              cell-center samples on each coordinate. A State Space scene previews all{' '}
              {formatCount(totalPoints)} cell centers with equal weight and the selected Appearance.
            </p>
            {workloadSummary}
          </section>
        ) : null}

        <InspectorDisclosure
          title="Frozen Variables"
          testId="frozen-variables-toggle"
          actionOnly={actionOnly}
          defaultOpen={!workflowFocus}
        >
          <section className="inspector-section" data-testid="frozen-variables-section">
          <div className="state-table__wrap" role="region" aria-label="Frozen variables">
            <table className="state-table__grid">
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Frozen</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {system.config.varNames.map((variableName) => {
                  const isFrozen = Object.prototype.hasOwnProperty.call(
                    frozenValues,
                    variableName
                  )
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
          </div>
          </section>
        </InspectorDisclosure>

        <InspectorDisclosure
          title="Parameters"
          testId="parameters-toggle"
          actionOnly={actionOnly}
          defaultOpen={!workflowFocus}
        >
          <section className="inspector-section" data-testid="param-override-section">
          <h3>Parameter values</h3>
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
          {object.customParameters ? (
            <button
              type="button"
              className="inspector-inline-button"
              onClick={() => onUpdateObjectParams(nodeId, null)}
              data-testid="param-override-clear"
            >
              Restore default parameters
            </button>
          ) : null}
          </section>
        </InspectorDisclosure>

        <InspectorDisclosure
          title="State Grid setup"
          testId="state-grid-setup-toggle"
          actionOnly={actionOnly}
          defaultOpen={!workflowFocus}
        >
          <section className="inspector-section">
        {workflowFocus?.activeWorkflow === 'state-grid-setup-toggle' ? workloadSummary : null}
        <h4 className="inspector-subheading">Bounds and resolution</h4>
        <div className="state-table__wrap" role="region" aria-label="Bounds and resolution">
          <table className="state-table__grid">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Min</th>
                <th>Max</th>
                <th>Resolution</th>
              </tr>
            </thead>
            <tbody>
              {object.axes.map((axis, index) => freeVariableNames.has(axis.variableName) ? (
                <tr key={axis.variableName}>
                  <td>{axis.variableName}</td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="state-table__input"
                      value={axisDrafts[axis.variableName]?.min ?? axis.min.toString()}
                      onChange={(event) => updateAxis(index, 'min', event.target.value)}
                      data-testid={`state-grid-${axis.variableName}-min`}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="state-table__input"
                      value={axisDrafts[axis.variableName]?.max ?? axis.max.toString()}
                      onChange={(event) => updateAxis(index, 'max', event.target.value)}
                      data-testid={`state-grid-${axis.variableName}-max`}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      className="state-table__input"
                      value={axisDrafts[axis.variableName]?.resolution ?? axis.resolution.toString()}
                      onChange={(event) => updateAxis(index, 'resolution', event.target.value)}
                      data-testid={`state-grid-${axis.variableName}-resolution`}
                    />
                  </td>
                </tr>
              ) : null)}
            </tbody>
          </table>
        </div>
          </section>
        </InspectorDisclosure>

        <InspectorDisclosure
          title="Expansion entropy"
          testId="state-grid-entropy-toggle"
          actionOnly={actionOnly}
          defaultOpen={!workflowFocus}
        >
          <section className="inspector-section">
        <h4 className="inspector-subheading">Expansion Entropy</h4>
        <p className="inspector-help">
          {isMap
            ? 'Hunt–Ott estimate restricted to this region, iteration horizon, and finite grid. Escaped trajectories contribute zero after the first map iterate outside the closed region. This is not unrestricted or exact topological entropy.'
            : 'Hunt–Ott estimate restricted to this region, time horizon, and finite grid. Escaped trajectories contribute zero. Escape is checked after each integration step. This is not unrestricted or exact topological entropy.'}
        </p>
        <label>
          {isMap ? 'Iterations' : 'Integration steps'}
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
            Step size
            <input
              type="number"
              min="0"
              value={object.analysis.dt}
              onChange={(event) => updateAnalysis('dt', event.target.value)}
              data-testid="state-grid-entropy-dt"
            />
          </label>
        ) : null}
        <label>
          Convergence checkpoint stride
          <input
            type="number"
            min={1}
            step={1}
            value={object.analysis.checkpointStride}
            onChange={(event) => updateAnalysis('checkpointStride', event.target.value)}
            data-testid="state-grid-entropy-checkpoint-stride"
          />
        </label>
        <label>
          Tangent stabilization stride
          <input
            type="number"
            min={1}
            step={1}
            value={object.analysis.stabilizationStride}
            onChange={(event) => updateAnalysis('stabilizationStride', event.target.value)}
            data-testid="state-grid-entropy-stabilization-stride"
          />
        </label>
        <div className="inspector-inline-actions">
          <button
            type="button"
            onClick={() => void run()}
            disabled={running || !Number.isFinite(totalPoints)}
            data-testid="state-grid-run-expansion-entropy"
          >
            {running ? 'Calculating…' : 'Calculate expansion entropy'}
          </button>
          {running ? (
            <button
              type="button"
              onClick={() => controllerRef.current?.abort()}
              data-testid="state-grid-cancel-expansion-entropy"
            >
              Cancel
            </button>
          ) : null}
        </div>
        {error ? <p className="inspector-error">{error}</p> : null}
      </section>

      <section className="inspector-section" data-testid="state-grid-expansion-entropy-result">
        <h3>{isMap ? 'Finite-iteration result' : 'Finite-time result'}</h3>
        {result ? (
          <>
            {resultStale ? (
              <p className="inspector-error">Stored result is stale for the current grid or system parameters.</p>
            ) : null}
            <div className="inspector-metrics">
              <div className="inspector-metrics__row">
                <span className="inspector-metrics__label">
                  {result.horizonKind === 'iteration' ? 'Final h(n)' : 'Final h(T)'}
                </span>
                <strong className="inspector-metrics__value" data-testid="state-grid-final-estimate">
                  {typeof finalEstimate === 'number' && Number.isFinite(finalEstimate)
                    ? finalEstimate.toPrecision(6)
                    : '−∞'}
                </strong>
              </div>
              <div className="inspector-metrics__row">
                <span className="inspector-metrics__label">Final survivors</span>
                <span className="inspector-metrics__value">
                  {result.survivorCounts.at(-1)?.toLocaleString() ?? 0} /{' '}
                  {result.totalSamples.toLocaleString()}
                </span>
              </div>
            </div>
            <p className="inspector-help">
              Scope:{' '}
              {result.horizonKind === 'iteration' ? 'finite iteration' : 'finite time'}, finite
              ensemble (State Grid), and region restricted.
            </p>
            {result.executionMode ? (
              <p className="inspector-help">
                Runtime: {result.executionMode === 'parallel'
                  ? `${result.workerCount ?? 1} Rust/WASM workers`
                  : 'serial Rust/WASM fallback'}.
              </p>
            ) : null}
            {result.conditioningWarning ? (
              <p className="inspector-error">
                Tangent conditioning exceeded the reliable floating-point range for at least one
                sample. Shorten the horizon or stabilization stride and compare results.
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
          <p className="empty-state">No expansion-entropy result stored yet.</p>
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
          <h4 className="inspector-subheading">Invariant measure</h4>
          <p className="inspector-help">
            Create a separate invariant-measure object from this State Grid. The result keeps its
            own rendering and computation snapshot, while this grid remains available for later
            analyses.
          </p>
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
          <p className="inspector-help">
            The ambient cell containing this point is the only initial cover cell. Newly reached
            cells are added within the State Grid before the conditional operator is built on the
            grown cover.
          </p>
          <label>
            Samples per cell
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
            <label>
              Map iterations per transition
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
            <label>
              Flow-map time per transition
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
            <label>
              Integration step size
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
          <label>
            Stationary iteration limit
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
          <label>
            Convergence tolerance
            <input
              type="number"
              min="0"
              value={transferSettings.tolerance}
              onChange={(event) => updateTransferSettings('tolerance', event.target.value)}
              data-testid="state-grid-transfer-tolerance"
            />
          </label>
          <p className="inspector-help">
            {isFlow
              ? 'Each transition advances the autonomous flow for the fixed map time using integration steps no larger than the configured step size. This is a sampled flow map, not a return map.'
              : 'Endpoints outside the closed grid are discarded. Each surviving source column is normalized by its own in-grid sample count.'}
          </p>
          <div className="inspector-inline-actions">
            <button
              type="button"
              onClick={() => void runTransferOperator()}
              disabled={running || !onComputeTransferOperator || !Number.isFinite(totalPoints)}
              data-testid="state-grid-create-invariant-measure"
            >
              {running ? 'Creating…' : 'Create invariant measure'}
            </button>
            {running ? (
              <button
                type="button"
                onClick={() => controllerRef.current?.abort()}
                data-testid="state-grid-cancel-invariant-measure"
              >
                Cancel
              </button>
            ) : null}
          </div>
          {error ? (
            <p className="inspector-error" data-testid="state-grid-transfer-error">
              {error}
            </p>
          ) : null}
          </section>
        </InspectorDisclosure>
        ) : null}
      </div>
    </div>
  )
}
