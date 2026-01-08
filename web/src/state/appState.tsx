import { createContext, useCallback, useContext, useMemo, useReducer } from 'react'
import type { ForkCoreClient, ValidateSystemResult } from '../compute/ForkCoreClient'
import type { JobTiming } from '../compute/jobQueue'
import { createSystem } from '../system/model'
import type {
  BifurcationDiagram,
  EquilibriumObject,
  EquilibriumSolverParams,
  LimitCycleObject,
  OrbitObject,
  System,
  SystemSummary,
  Scene,
  SystemConfig,
  TreeNode,
} from '../system/types'
import type { SystemStore } from '../system/store'
import {
  addBifurcationDiagram,
  addObject,
  addScene,
  moveNode,
  reorderNode,
  removeNode,
  renameNode,
  selectNode,
  toggleNodeExpanded,
  toggleNodeVisibility,
  updateBifurcationDiagram,
  updateLayout,
  updateNodeRender,
  updateObject,
  updateScene,
  updateSystem,
} from '../system/model'
import { downloadSystem, readSystemFile } from '../system/importExport'

const CLI_SAFE_NAME = /^[a-zA-Z0-9_]+$/
const IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export type SystemValidation = {
  valid: boolean
  errors: {
    name?: string
    varNames?: string
    paramNames?: string
    equations?: string[]
    params?: string[]
    solver?: string
  }
  warnings: string[]
}

export type OrbitRunRequest = {
  orbitId: string
  initialState: number[]
  duration: number
  dt?: number
}

export type EquilibriumSolveRequest = {
  equilibriumId: string
  initialGuess: number[]
  maxSteps: number
  dampingFactor: number
}

export type LimitCycleCreateRequest = {
  name: string
  originOrbitId: string
  period: number
  state: number[]
  ntst: number
  ncol: number
  parameterName?: string
}

export function validateSystemConfig(system: SystemConfig): SystemValidation {
  const errors: SystemValidation['errors'] = {}
  const warnings: string[] = []

  if (!system.name.trim()) {
    errors.name = 'System name is required.'
  } else if (!CLI_SAFE_NAME.test(system.name)) {
    warnings.push('System name is not CLI-safe; use alphanumerics and underscores for parity.')
  }

  if (system.varNames.some((name) => name.trim().length === 0)) {
    errors.varNames = 'Variable names cannot be empty.'
  }
  const varNames = system.varNames.map((name) => name.trim()).filter((name) => name.length > 0)
  if (varNames.length === 0) {
    errors.varNames = 'At least one variable is required.'
  } else if (!errors.varNames) {
    const invalidVars = varNames.filter((name) => !IDENTIFIER_REGEX.test(name))
    if (invalidVars.length > 0) {
      errors.varNames = `Invalid variable names: ${invalidVars.join(', ')}.`
    } else {
      const duplicateVars = varNames.filter(
        (name, index) => varNames.indexOf(name) !== index
      )
      if (duplicateVars.length > 0) {
        errors.varNames = `Duplicate variable names: ${[...new Set(duplicateVars)].join(', ')}.`
      }
    }
  }

  if (system.paramNames.some((name) => name.trim().length === 0)) {
    errors.paramNames = 'Parameter names cannot be empty.'
  }
  if (system.paramNames.length > 0 && !errors.paramNames) {
    const invalidParams = system.paramNames.filter((name) => !IDENTIFIER_REGEX.test(name))
    if (invalidParams.length > 0) {
      errors.paramNames = `Invalid parameter names: ${invalidParams.join(', ')}.`
    } else {
      const duplicateParams = system.paramNames.filter(
        (name, index) => system.paramNames.indexOf(name) !== index
      )
      if (duplicateParams.length > 0) {
        errors.paramNames = `Duplicate parameter names: ${[
          ...new Set(duplicateParams),
        ].join(', ')}.`
      }
    }
  }

  const equationErrors: string[] = []
  for (let i = 0; i < system.varNames.length; i += 1) {
    const eq = system.equations[i]
    if (!eq || !eq.trim()) {
      equationErrors[i] = 'Equation required.'
    }
  }
  if (equationErrors.some(Boolean)) {
    errors.equations = equationErrors
  }

  if (system.paramNames.length !== system.params.length) {
    errors.params = system.paramNames.map(() => 'Parameter count mismatch.')
  } else if (system.params.some((value) => !Number.isFinite(value))) {
    errors.params = system.params.map((value) =>
      Number.isFinite(value) ? '' : 'Parameter must be numeric.'
    )
  }

  if (system.type === 'map' && system.solver !== 'discrete') {
    errors.solver = 'Map systems must use the discrete solver.'
  }
  if (system.type === 'flow' && !['rk4', 'tsit5'].includes(system.solver)) {
    errors.solver = 'Flow systems must use rk4 or tsit5.'
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    warnings,
  }
}

type AppState = {
  system: System | null
  systems: SystemSummary[]
  busy: boolean
  error: string | null
  timings: JobTiming[]
}

type AppAction =
  | { type: 'SET_SYSTEM'; system: System | null }
  | { type: 'SET_SYSTEMS'; systems: SystemSummary[] }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'ADD_TIMING'; timing: JobTiming }

const initialState: AppState = {
  system: null,
  systems: [],
  busy: false,
  error: null,
  timings: [],
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_SYSTEM':
      return { ...state, system: action.system }
    case 'SET_SYSTEMS':
      return { ...state, systems: action.systems }
    case 'SET_BUSY':
      return { ...state, busy: action.busy }
    case 'SET_ERROR':
      return { ...state, error: action.error }
    case 'ADD_TIMING':
      return { ...state, timings: [action.timing, ...state.timings].slice(0, 100) }
    default:
      return state
  }
}

type AppActions = {
  refreshSystems: () => Promise<void>
  createSystem: (name: string) => Promise<void>
  openSystem: (id: string) => Promise<void>
  saveSystem: () => Promise<void>
  exportSystem: (id: string) => Promise<void>
  deleteSystem: (id: string) => Promise<void>
  updateSystem: (system: SystemConfig) => Promise<void>
  validateSystem: (
    system: SystemConfig,
    opts?: { signal?: AbortSignal }
  ) => Promise<ValidateSystemResult>
  selectNode: (nodeId: string | null) => void
  renameNode: (nodeId: string, name: string) => void
  toggleVisibility: (nodeId: string) => void
  toggleExpanded: (nodeId: string) => void
  moveNode: (nodeId: string, direction: 'up' | 'down') => void
  reorderNode: (nodeId: string, targetId: string) => void
  updateLayout: (layout: Partial<System['ui']['layout']>) => void
  updateRender: (nodeId: string, render: Partial<TreeNode['render']>) => void
  updateScene: (sceneId: string, update: Partial<Omit<Scene, 'id' | 'name'>>) => void
  updateBifurcationDiagram: (
    diagramId: string,
    update: Partial<Omit<BifurcationDiagram, 'id' | 'name'>>
  ) => void
  deleteNode: (nodeId: string) => Promise<void>
  createOrbitObject: (name: string) => Promise<string | null>
  createEquilibriumObject: (name: string) => Promise<string | null>
  runOrbit: (request: OrbitRunRequest) => Promise<void>
  solveEquilibrium: (request: EquilibriumSolveRequest) => Promise<void>
  createLimitCycleObject: (request: LimitCycleCreateRequest) => Promise<void>
  addScene: (name: string) => Promise<void>
  addBifurcationDiagram: (name: string) => Promise<void>
  importSystem: (file: File) => Promise<void>
  clearError: () => void
}

type AppContextValue = {
  state: AppState
  actions: AppActions
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({
  store,
  client,
  initialSystem,
  initialSystems,
  children,
}: {
  store: SystemStore
  client: ForkCoreClient
  initialSystem?: System | null
  initialSystems?: SystemSummary[]
  children: React.ReactNode
}) {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    system: initialSystem ?? initialState.system,
    systems: initialSystems ?? initialState.systems,
  })

  const refreshSystems = useCallback(async () => {
    try {
      const systems = await store.list()
      dispatch({ type: 'SET_SYSTEMS', systems })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'SET_ERROR', error: message })
    }
  }, [store])

  const createSystemAction = useCallback(
    async (name: string) => {
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system = createSystem({ name })
        dispatch({ type: 'SET_SYSTEM', system })
        await store.save(system)
        await refreshSystems()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [refreshSystems, store]
  )

  const openSystem = useCallback(
    async (id: string) => {
      dispatch({ type: 'SET_BUSY', busy: true })
      const system = await store.load(id)
      dispatch({ type: 'SET_SYSTEM', system })
      dispatch({ type: 'SET_BUSY', busy: false })
    },
    [store]
  )

  const saveSystem = useCallback(async () => {
    if (!state.system) return
    dispatch({ type: 'SET_BUSY', busy: true })
    await store.save(state.system)
    await refreshSystems()
    dispatch({ type: 'SET_BUSY', busy: false })
  }, [refreshSystems, state.system, store])

  const exportSystem = useCallback(
    async (id: string) => {
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system =
          state.system && state.system.id === id ? state.system : await store.load(id)
        downloadSystem(system)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const deleteSystem = useCallback(
    async (id: string) => {
      dispatch({ type: 'SET_BUSY', busy: true })
      await store.remove(id)
      await refreshSystems()
      dispatch({ type: 'SET_BUSY', busy: false })
    },
    [refreshSystems, store]
  )

  const updateSystemAction = useCallback(
    async (config: SystemConfig) => {
      if (!state.system) return
      const validation = validateSystemConfig(config)
      if (!validation.valid) {
        dispatch({ type: 'SET_ERROR', error: 'System settings are invalid. Fix errors first.' })
        return
      }
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const nextSystem = updateSystem(state.system, config)
        dispatch({ type: 'SET_SYSTEM', system: nextSystem })
        await store.save(nextSystem)
        await refreshSystems()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [refreshSystems, state.system, store]
  )

  const validateSystemAction = useCallback(
    async (system: SystemConfig, opts?: { signal?: AbortSignal }) => {
      return await client.validateSystem({ system }, opts)
    },
    [client]
  )

  const selectNodeAction = useCallback(
    (nodeId: string | null) => {
      if (!state.system) return
      const system = selectNode(state.system, nodeId)
      dispatch({ type: 'SET_SYSTEM', system })
    },
    [state.system]
  )

  const renameNodeAction = useCallback(
    (nodeId: string, name: string) => {
      if (!state.system) return
      const system = renameNode(state.system, nodeId, name)
      dispatch({ type: 'SET_SYSTEM', system })
    },
    [state.system]
  )

  const toggleVisibilityAction = useCallback(
    (nodeId: string) => {
      if (!state.system) return
      const system = toggleNodeVisibility(state.system, nodeId)
      dispatch({ type: 'SET_SYSTEM', system })
    },
    [state.system]
  )

  const toggleExpandedAction = useCallback(
    (nodeId: string) => {
      if (!state.system) return
      const system = toggleNodeExpanded(state.system, nodeId)
      dispatch({ type: 'SET_SYSTEM', system })
    },
    [state.system]
  )

  const moveNodeAction = useCallback(
    (nodeId: string, direction: 'up' | 'down') => {
      if (!state.system) return
      const system = moveNode(state.system, nodeId, direction)
      dispatch({ type: 'SET_SYSTEM', system })
    },
    [state.system]
  )

  const reorderNodeAction = useCallback(
    (nodeId: string, targetId: string) => {
      if (!state.system) return
      const system = reorderNode(state.system, nodeId, targetId)
      dispatch({ type: 'SET_SYSTEM', system })
    },
    [state.system]
  )

  const updateLayoutAction = useCallback(
    (layout: Partial<System['ui']['layout']>) => {
      if (!state.system) return
      const system = updateLayout(state.system, layout)
      dispatch({ type: 'SET_SYSTEM', system })
    },
    [state.system]
  )

  const updateRenderAction = useCallback(
    (nodeId: string, render: Partial<TreeNode['render']>) => {
      if (!state.system) return
      const system = updateNodeRender(state.system, nodeId, render)
      dispatch({ type: 'SET_SYSTEM', system })
    },
    [state.system]
  )

  const updateSceneAction = useCallback(
    (sceneId: string, update: Partial<Omit<Scene, 'id' | 'name'>>) => {
      if (!state.system) return
      const system = updateScene(state.system, sceneId, update)
      dispatch({ type: 'SET_SYSTEM', system })
    },
    [state.system]
  )

  const updateBifurcationDiagramAction = useCallback(
    (diagramId: string, update: Partial<Omit<BifurcationDiagram, 'id' | 'name'>>) => {
      if (!state.system) return
      const system = updateBifurcationDiagram(state.system, diagramId, update)
      dispatch({ type: 'SET_SYSTEM', system })
    },
    [state.system]
  )

  const deleteNodeAction = useCallback(
    async (nodeId: string) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system = removeNode(state.system, nodeId)
        dispatch({ type: 'SET_SYSTEM', system })
        await store.save(system)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const createOrbitObject = useCallback(
    async (name: string) => {
      if (!state.system) return null
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        // Create the orbit shell first; simulation runs later from the selection inspector.
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const trimmedName = name.trim()
        if (!trimmedName) {
          throw new Error('Orbit name is required.')
        }
        const existingNames = Object.values(state.system.objects).map((obj) => obj.name)
        if (existingNames.includes(trimmedName)) {
          throw new Error(`Object "${trimmedName}" already exists.`)
        }

        const dt = system.type === 'map' ? 1 : 0.01
        const obj: OrbitObject = {
          type: 'orbit',
          name: trimmedName,
          systemName: system.name,
          data: [],
          t_start: 0,
          t_end: 0,
          dt,
          parameters: [...system.params],
        }

        const result = addObject(state.system, obj)
        const selected = selectNode(result.system, result.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
        return result.nodeId
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
        return null
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const runOrbit = useCallback(
    async (request: OrbitRunRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const orbit = state.system.objects[request.orbitId]
        if (!orbit || orbit.type !== 'orbit') {
          throw new Error('Select a valid orbit to integrate.')
        }
        if (request.initialState.length !== system.varNames.length) {
          throw new Error('Initial state dimension mismatch.')
        }
        if (request.initialState.some((value) => !Number.isFinite(value))) {
          throw new Error('Initial state values must be numeric.')
        }

        const dt = system.type === 'map' ? 1 : request.dt ?? orbit.dt ?? 0.01
        if (!Number.isFinite(dt) || dt <= 0) {
          throw new Error('Step size must be a positive number.')
        }
        if (!Number.isFinite(request.duration) || request.duration <= 0) {
          throw new Error('Duration must be a positive number.')
        }
        const steps =
          system.type === 'map'
            ? Math.max(1, Math.ceil(request.duration))
            : Math.max(1, Math.ceil(request.duration / dt))

        const result = await client.simulateOrbit({
          system,
          initialState: request.initialState,
          steps,
          dt,
        })

        const updated = updateObject(state.system, request.orbitId, {
          data: result.data,
          t_start: result.t_start,
          t_end: result.t_end,
          dt: result.dt,
          parameters: [...system.params],
        })
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.save(updated)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createEquilibriumObject = useCallback(
    async (name: string) => {
      if (!state.system) return null
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        // Create the equilibrium shell first; solving runs later from the selection inspector.
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const trimmedName = name.trim()
        if (!trimmedName) {
          throw new Error('Equilibrium name is required.')
        }
        const existingNames = Object.values(state.system.objects).map((obj) => obj.name)
        if (existingNames.includes(trimmedName)) {
          throw new Error(`Object "${trimmedName}" already exists.`)
        }

        const solverParams: EquilibriumSolverParams = {
          initialGuess: system.varNames.map(() => 0),
          maxSteps: 25,
          dampingFactor: 1,
        }

        const obj: EquilibriumObject = {
          type: 'equilibrium',
          name: trimmedName,
          systemName: system.name,
          parameters: [...system.params],
          lastSolverParams: solverParams,
        }
        const result = addObject(state.system, obj)
        const selected = selectNode(result.system, result.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
        return result.nodeId
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
        return null
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const solveEquilibrium = useCallback(
    async (request: EquilibriumSolveRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      const system = state.system.config
      const runSummary = {
        timestamp: new Date().toISOString(),
        success: false,
        residual_norm: undefined as number | undefined,
        iterations: undefined as number | undefined,
      }

      try {
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const equilibrium = state.system.objects[request.equilibriumId]
        if (!equilibrium || equilibrium.type !== 'equilibrium') {
          throw new Error('Select a valid equilibrium to solve.')
        }
        if (request.initialGuess.length !== system.varNames.length) {
          throw new Error('Initial guess dimension mismatch.')
        }
        if (request.initialGuess.some((value) => !Number.isFinite(value))) {
          throw new Error('Initial guess values must be numeric.')
        }
        if (!Number.isFinite(request.maxSteps) || request.maxSteps <= 0) {
          throw new Error('Max steps must be a positive number.')
        }
        if (!Number.isFinite(request.dampingFactor) || request.dampingFactor <= 0) {
          throw new Error('Damping factor must be a positive number.')
        }

        const solverParams: EquilibriumSolverParams = {
          initialGuess: request.initialGuess,
          maxSteps: request.maxSteps,
          dampingFactor: request.dampingFactor,
        }

        const result = await client.solveEquilibrium({
          system,
          initialGuess: solverParams.initialGuess,
          maxSteps: solverParams.maxSteps,
          dampingFactor: solverParams.dampingFactor,
        })

        runSummary.success = true
        runSummary.residual_norm = result.residual_norm
        runSummary.iterations = result.iterations

        const updated = updateObject(state.system, request.equilibriumId, {
          solution: result,
          parameters: [...system.params],
          lastSolverParams: solverParams,
          lastRun: runSummary,
        })
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.save(updated)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
        const updated = updateObject(state.system, request.equilibriumId, {
          lastRun: runSummary,
          lastSolverParams: {
            initialGuess: request.initialGuess,
            maxSteps: request.maxSteps,
            dampingFactor: request.dampingFactor,
          },
        })
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.save(updated)
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createLimitCycleObject = useCallback(
    async (request: LimitCycleCreateRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type === 'map') {
          throw new Error('Limit cycles require a flow system.')
        }
        const trimmedName = request.name.trim()
        if (!trimmedName) {
          throw new Error('Limit cycle name is required.')
        }
        const existingNames = Object.values(state.system.objects).map((obj) => obj.name)
        if (existingNames.includes(trimmedName)) {
          throw new Error(`Object "${trimmedName}" already exists.`)
        }
        const orbit = state.system.objects[request.originOrbitId]
        if (!orbit || orbit.type !== 'orbit') {
          throw new Error('Select a valid orbit for limit cycle initialization.')
        }
        if (request.state.length !== system.varNames.length) {
          throw new Error('Limit cycle state dimension mismatch.')
        }
        if (request.state.some((value) => !Number.isFinite(value))) {
          throw new Error('Limit cycle state values must be numeric.')
        }
        if (!Number.isFinite(request.period) || request.period <= 0) {
          throw new Error('Period must be a positive number.')
        }
        if (!Number.isFinite(request.ntst) || request.ntst <= 0) {
          throw new Error('NTST must be a positive number.')
        }
        if (!Number.isFinite(request.ncol) || request.ncol <= 0) {
          throw new Error('NCOL must be a positive number.')
        }

        const paramName = request.parameterName
        const paramIndex = paramName ? system.paramNames.indexOf(paramName) : -1
        const paramValue = paramIndex >= 0 ? system.params[paramIndex] : undefined

        const lcState = [...request.state, request.period]

        const obj: LimitCycleObject = {
          type: 'limit_cycle',
          name: trimmedName,
          systemName: system.name,
          origin: { type: 'orbit', orbitName: orbit.name },
          ntst: Math.round(request.ntst),
          ncol: Math.round(request.ncol),
          period: request.period,
          state: lcState,
          parameters: [...system.params],
          parameterName: paramIndex >= 0 ? paramName : undefined,
          paramValue,
          createdAt: new Date().toISOString(),
        }

        const updated = addObject(state.system, obj).system
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.save(updated)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const addSceneAction = useCallback(
    async (name: string) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const updated = addScene(state.system, name).system
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.save(updated)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const addBifurcationDiagramAction = useCallback(
    async (name: string) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const updated = addBifurcationDiagram(state.system, name).system
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.save(updated)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const importSystem = useCallback(
    async (file: File) => {
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system = await readSystemFile(file)
        await store.save(system)
        dispatch({ type: 'SET_SYSTEM', system })
        await refreshSystems()
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [refreshSystems, store]
  )

  const actions: AppActions = useMemo(
    () => ({
      refreshSystems,
      createSystem: createSystemAction,
      openSystem,
      saveSystem,
      exportSystem,
      deleteSystem,
      updateSystem: updateSystemAction,
      validateSystem: validateSystemAction,
      selectNode: selectNodeAction,
      renameNode: renameNodeAction,
      toggleVisibility: toggleVisibilityAction,
      toggleExpanded: toggleExpandedAction,
      moveNode: moveNodeAction,
      reorderNode: reorderNodeAction,
      updateLayout: updateLayoutAction,
      updateRender: updateRenderAction,
      updateScene: updateSceneAction,
      updateBifurcationDiagram: updateBifurcationDiagramAction,
      deleteNode: deleteNodeAction,
      createOrbitObject,
      createEquilibriumObject,
      runOrbit,
      solveEquilibrium,
      createLimitCycleObject,
      addScene: addSceneAction,
      addBifurcationDiagram: addBifurcationDiagramAction,
      importSystem,
      clearError: () => dispatch({ type: 'SET_ERROR', error: null }),
    }),
    [
      createEquilibriumObject,
      createLimitCycleObject,
      createOrbitObject,
      runOrbit,
      solveEquilibrium,
      addBifurcationDiagramAction,
      createSystemAction,
      deleteSystem,
      openSystem,
      refreshSystems,
      renameNodeAction,
      saveSystem,
      exportSystem,
      updateSystemAction,
      validateSystemAction,
      selectNodeAction,
      toggleExpandedAction,
      toggleVisibilityAction,
      moveNodeAction,
      reorderNodeAction,
      updateLayoutAction,
      updateRenderAction,
      updateSceneAction,
      updateBifurcationDiagramAction,
      deleteNodeAction,
      addSceneAction,
      importSystem,
    ]
  )

  return (
    <AppContext.Provider
      value={{
        state,
        actions,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useAppContext() {
  const ctx = useContext(AppContext)
  if (!ctx) {
    throw new Error('useAppContext must be used within AppProvider')
  }
  return ctx
}
