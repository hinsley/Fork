import { useEffect, useMemo, useState } from 'react'
import type {
  BifurcationDiagram,
  EquilibriumObject,
  OrbitObject,
  Scene,
  System,
  SystemConfig,
  TreeNode,
} from '../system/types'
import { DEFAULT_RENDER } from '../system/model'
import type {
  LimitCycleCreateRequest,
  EquilibriumSolveRequest,
  OrbitRunRequest,
} from '../state/appState'
import { validateSystemConfig } from '../state/appState'

type InspectorDetailsPanelProps = {
  system: System
  selectedNodeId: string | null
  view: 'selection' | 'system'
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
  onSolveEquilibrium: (request: EquilibriumSolveRequest) => Promise<void>
  onCreateLimitCycle: (request: LimitCycleCreateRequest) => Promise<void>
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

const FLOW_SOLVERS = ['rk4', 'tsit5']
const MAP_SOLVERS = ['discrete']

function nextName(prefix: string, existing: string[]) {
  let index = 1
  let name = `${prefix} ${index}`
  while (existing.includes(name)) {
    index += 1
    name = `${prefix} ${index}`
  }
  return name
}

function adjustArray<T>(values: T[], targetLength: number, fill: () => T): T[] {
  if (values.length === targetLength) return values
  if (values.length > targetLength) return values.slice(0, targetLength)
  return [...values, ...Array.from({ length: targetLength - values.length }, fill)]
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

export function InspectorDetailsPanel({
  system,
  selectedNodeId,
  view,
  onRename,
  onToggleVisibility,
  onUpdateRender,
  onUpdateScene,
  onUpdateBifurcationDiagram,
  onUpdateSystem,
  onValidateSystem,
  onRunOrbit,
  onSolveEquilibrium,
  onCreateLimitCycle,
}: InspectorDetailsPanelProps) {
  const node = selectedNodeId ? system.nodes[selectedNodeId] : null
  const object = selectedNodeId ? system.objects[selectedNodeId] : undefined
  const branch = selectedNodeId ? system.branches[selectedNodeId] : undefined
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
  const nodeRender = selectionNode
    ? { ...DEFAULT_RENDER, ...(selectionNode.render ?? {}) }
    : DEFAULT_RENDER
  const nodeVisibility = selectionNode?.visibility ?? true
  const branchEntries = useMemo(() => Object.entries(system.branches), [system.branches])

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

  const [equilibriumDraft, setEquilibriumDraft] = useState<EquilibriumSolveDraft>(() =>
    makeEquilibriumSolveDraft(system.config)
  )
  const [equilibriumError, setEquilibriumError] = useState<string | null>(null)

  const [limitCycleDraft, setLimitCycleDraft] = useState<LimitCycleDraft>(() =>
    makeLimitCycleDraft(system.config)
  )
  const [limitCycleError, setLimitCycleError] = useState<string | null>(null)

  useEffect(() => {
    setSystemDraft(makeSystemDraft(system.config))
    setSystemTouched(false)
    setWasmEquationErrors([])
    setWasmMessage(null)
  }, [system.id])

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
    if (!object) return
    if (object.type === 'orbit') {
      setOrbitDraft(makeOrbitRunDraft(system.config, object))
      setLimitCycleDraft((prev) => ({
        ...makeLimitCycleDraft(system.config, object),
        name: prev.name,
      }))
      setOrbitError(null)
      setLimitCycleError(null)
    }
    if (object.type === 'equilibrium') {
      setEquilibriumDraft(makeEquilibriumSolveDraft(system.config, object))
      setEquilibriumError(null)
    }
  }, [object?.type, selectedNodeId, system.config])

  const systemConfig = useMemo(() => buildSystemConfig(systemDraft), [systemDraft])
  const systemValidation = useMemo(() => validateSystemConfig(systemConfig), [systemConfig])
  const systemDirty = useMemo(
    () => !isSystemEqual(systemConfig, system.config),
    [system.config, systemConfig]
  )
  const showSystemErrors = systemTouched || systemDirty
  const hasWasmErrors = wasmEquationErrors.some((entry) => entry)
  const runDisabled = systemDirty || !systemValidation.valid || hasWasmErrors

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

    if (scene) {
      return {
        label: 'Scene',
        detail: scene.display === 'selection' ? 'Selection focus' : 'All visible orbits',
      }
    }

    if (diagram) {
      return {
        label: 'Bifurcation',
        detail: diagram.branchId ? 'Branch linked' : 'No branch linked',
      }
    }

    return null
  }, [object, scene, diagram])

  const limitCycleNameSuggestion = useMemo(() => {
    const names = Object.values(system.objects).map((obj) => obj.name)
    return nextName('Limit Cycle', names)
  }, [system.objects])

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

  const renderSelectionView = () => (
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

          <div className="inspector-section">
            <button
              onClick={() => onToggleVisibility(selectionNode.id)}
              data-testid="inspector-visibility"
            >
              {nodeVisibility ? 'Visible' : 'Hidden'}
            </button>
          </div>

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

          {object?.type === 'orbit' ? (
            <>
              <div className="inspector-section">
                <h3>Orbit Simulation</h3>
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

              <div className="inspector-section">
                <h3>Limit Cycle</h3>
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
            </>
          ) : null}

          {object?.type === 'equilibrium' ? (
            <div className="inspector-section">
              <h3>Equilibrium Solver</h3>
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
          ) : null}

          {scene ? (
            <div className="inspector-section">
              <h3>Scene</h3>
              <label>
                Display
                <select
                  value={scene.display}
                  onChange={(event) =>
                    onUpdateScene(scene.id, {
                      display: event.target.value as Scene['display'],
                    })
                  }
                  data-testid="scene-display"
                >
                  <option value="all">All visible orbits</option>
                  <option value="selection">Selection only</option>
                </select>
              </label>
            </div>
          ) : null}

          {diagram ? (
            <div className="inspector-section">
              <h3>Bifurcation Diagram</h3>
              {branchEntries.length > 0 ? (
                <label>
                  Branch
                  <select
                    value={diagram.branchId ?? ''}
                    onChange={(event) =>
                      onUpdateBifurcationDiagram(diagram.id, {
                        branchId: event.target.value ? event.target.value : null,
                      })
                    }
                    data-testid="diagram-branch"
                  >
                    <option value="">Unassigned</option>
                    {branchEntries.map(([id, entry]) => (
                      <option key={id} value={id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="empty-state">No branches available yet.</p>
              )}

              {system.config.paramNames.length > 0 ? (
                <>
                  <label>
                    X Parameter
                    <select
                      value={diagram.xParam ?? ''}
                      onChange={(event) =>
                        onUpdateBifurcationDiagram(diagram.id, {
                          xParam: event.target.value ? event.target.value : null,
                        })
                      }
                      data-testid="diagram-x-param"
                    >
                      <option value="">Unassigned</option>
                      {system.config.paramNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Y Parameter
                    <select
                      value={diagram.yParam ?? ''}
                      onChange={(event) =>
                        onUpdateBifurcationDiagram(diagram.id, {
                          yParam: event.target.value ? event.target.value : null,
                        })
                      }
                      data-testid="diagram-y-param"
                    >
                      <option value="">None</option>
                      {system.config.paramNames.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <p className="empty-state">Add parameters to configure axes.</p>
              )}
            </div>
          ) : null}

          {branch ? (
            <div className="inspector-section">
              <h3>Branch</h3>
              <p>{branch.branchType}</p>
              <p>{branch.data.points.length} points</p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="empty-state">Select a node to inspect details.</p>
      )}
    </div>
  )

  if (view === 'system') return renderSystemView()
  return renderSelectionView()
}
