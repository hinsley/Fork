import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import type {
  ContinuationProgress,
  CovariantLyapunovRequest as CoreCovariantLyapunovRequest,
  CovariantLyapunovResponse,
  ForkCoreClient,
  LyapunovExponentsRequest as CoreLyapunovExponentsRequest,
  SampleMap1DFunctionRequest,
  SampleMap1DFunctionResult,
  ValidateSystemResult,
} from '../compute/ForkCoreClient'
import type { JobTiming } from '../compute/jobQueue'
import { createSystem } from '../system/model'
import type {
  BifurcationDiagram,
  ContinuationObject,
  ContinuationPoint,
  ContinuationSettings,
  CovariantLyapunovData,
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
  addBranch,
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
  updateViewportHeights,
  updateNodeRender,
  updateObject,
  updateBranch,
  updateScene,
  updateSystem,
} from '../system/model'
import {
  extractHopfOmega,
  getBranchParams,
  normalizeEigenvalueArray,
  normalizeBranchEigenvalues,
  serializeBranchDataForWasm,
} from '../system/continuation'
import { downloadSystem, readSystemFile } from '../system/importExport'
import { AppContext } from './appContext'
import { validateSystemConfig } from './systemValidation'
import { isCliSafeName } from '../utils/naming'

function findObjectIdByName(system: System, name: string): string | null {
  const match = Object.entries(system.objects).find(([, obj]) => obj.name === name)
  return match ? match[0] : null
}

function branchNameExists(system: System, parentName: string, name: string): boolean {
  return Object.values(system.branches).some(
    (branch) => branch.parentObject === parentName && branch.name === name
  )
}

function validateBranchName(name: string): string | null {
  if (!name.trim()) return 'Branch name is required.'
  if (!isCliSafeName(name)) {
    return 'Branch names must be alphanumeric with underscores only.'
  }
  return null
}

function validateObjectName(name: string, label: string): string | null {
  if (!name.trim()) return `${label} name is required.`
  if (!isCliSafeName(name)) {
    return `${label} names must be alphanumeric with underscores only.`
  }
  return null
}

function getNodeLabel(node: TreeNode | undefined): string {
  if (!node) return 'Item'
  if (node.kind === 'branch') return 'Branch'
  if (node.kind === 'scene') return 'Scene'
  if (node.kind === 'diagram') return 'Bifurcation diagram'
  if (node.kind === 'object') {
    if (node.objectType === 'orbit') return 'Orbit'
    if (node.objectType === 'equilibrium') return 'Equilibrium'
    if (node.objectType === 'limit_cycle') return 'Limit cycle'
    return 'Object'
  }
  return 'Item'
}

function reshapeCovariantVectors(
  payload: CovariantLyapunovResponse
): CovariantLyapunovData {
  const { dimension, checkpoints, vectors, times } = payload
  if (dimension <= 0) {
    throw new Error('Invalid dimension for covariant Lyapunov vectors.')
  }
  if (checkpoints <= 0) {
    throw new Error('No checkpoints returned for covariant Lyapunov vectors.')
  }
  const expected = dimension * dimension * checkpoints
  if (vectors.length < expected) {
    throw new Error('Covariant Lyapunov payload is incomplete.')
  }

  const shaped: number[][][] = []
  for (let step = 0; step < checkpoints; step += 1) {
    const base = step * dimension * dimension
    const stepVectors: number[][] = []
    for (let vecIdx = 0; vecIdx < dimension; vecIdx += 1) {
      const vec: number[] = []
      for (let component = 0; component < dimension; component += 1) {
        const index = base + component * dimension + vecIdx
        vec.push(vectors[index])
      }
      stepVectors.push(vec)
    }
    shaped.push(stepVectors)
  }

  return {
    dim: dimension,
    times: times.slice(0, checkpoints),
    vectors: shaped,
  }
}

export type ContinuationProgressState = {
  label: string
  progress: ContinuationProgress
}

export type OrbitRunRequest = {
  orbitId: string
  initialState: number[]
  duration: number
  dt?: number
}

export type OrbitLyapunovRequest = {
  orbitId: string
  transient: number
  qrStride: number
}

export type OrbitCovariantLyapunovRequest = {
  orbitId: string
  transient: number
  forward: number
  backward: number
  qrStride: number
}

export type EquilibriumSolveRequest = {
  equilibriumId: string
  initialGuess: number[]
  maxSteps: number
  dampingFactor: number
}

export type EquilibriumContinuationRequest = {
  equilibriumId: string
  name: string
  parameterName: string
  settings: ContinuationSettings
  forward: boolean
}

export type BranchContinuationRequest = {
  branchId: string
  pointIndex: number
  name: string
  parameterName: string
  settings: ContinuationSettings
  forward: boolean
}

export type BranchExtensionRequest = {
  branchId: string
  settings: ContinuationSettings
  forward: boolean
}

export type FoldCurveContinuationRequest = {
  branchId: string
  pointIndex: number
  name: string
  param2Name: string
  settings: ContinuationSettings
  forward: boolean
}

export type HopfCurveContinuationRequest = {
  branchId: string
  pointIndex: number
  name: string
  param2Name: string
  settings: ContinuationSettings
  forward: boolean
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

export type LimitCycleOrbitContinuationRequest = {
  orbitId: string
  limitCycleName: string
  branchName: string
  parameterName: string
  tolerance: number
  ntst: number
  ncol: number
  settings: ContinuationSettings
  forward: boolean
}

export type LimitCyclePDContinuationRequest = {
  branchId: string
  pointIndex: number
  limitCycleName: string
  branchName: string
  amplitude: number
  ncol: number
  settings: ContinuationSettings
  forward: boolean
}

export type LimitCycleHopfContinuationRequest = {
  branchId: string
  pointIndex: number
  limitCycleName: string
  branchName: string
  amplitude: number
  ntst: number
  ncol: number
  settings: ContinuationSettings
  forward: boolean
}


type AppState = {
  system: System | null
  systems: SystemSummary[]
  busy: boolean
  error: string | null
  timings: JobTiming[]
  continuationProgress: ContinuationProgressState | null
}

type AppAction =
  | { type: 'SET_SYSTEM'; system: System | null }
  | { type: 'SET_SYSTEMS'; systems: SystemSummary[] }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'ADD_TIMING'; timing: JobTiming }
  | { type: 'SET_CONTINUATION_PROGRESS'; progress: ContinuationProgressState | null }

const initialState: AppState = {
  system: null,
  systems: [],
  busy: false,
  error: null,
  timings: [],
  continuationProgress: null,
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
    case 'SET_CONTINUATION_PROGRESS':
      return { ...state, continuationProgress: action.progress }
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
  updateViewportHeight: (nodeId: string, height: number) => void
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
  sampleMap1DFunction: (
    request: SampleMap1DFunctionRequest,
    opts?: { signal?: AbortSignal }
  ) => Promise<SampleMap1DFunctionResult>
  computeLyapunovExponents: (request: OrbitLyapunovRequest) => Promise<void>
  computeCovariantLyapunovVectors: (request: OrbitCovariantLyapunovRequest) => Promise<void>
  solveEquilibrium: (request: EquilibriumSolveRequest) => Promise<void>
  createEquilibriumBranch: (request: EquilibriumContinuationRequest) => Promise<void>
  createBranchFromPoint: (request: BranchContinuationRequest) => Promise<void>
  extendBranch: (request: BranchExtensionRequest) => Promise<void>
  createFoldCurveFromPoint: (request: FoldCurveContinuationRequest) => Promise<void>
  createHopfCurveFromPoint: (request: HopfCurveContinuationRequest) => Promise<void>
  createLimitCycleObject: (request: LimitCycleCreateRequest) => Promise<void>
  createLimitCycleFromOrbit: (request: LimitCycleOrbitContinuationRequest) => Promise<void>
  createLimitCycleFromHopf: (request: LimitCycleHopfContinuationRequest) => Promise<void>
  createLimitCycleFromPD: (request: LimitCyclePDContinuationRequest) => Promise<void>
  addScene: (name: string, targetId?: string | null) => Promise<void>
  addBifurcationDiagram: (name: string, targetId?: string | null) => Promise<void>
  importSystem: (file: File) => Promise<void>
  clearError: () => void
}

export type AppContextValue = {
  state: AppState
  actions: AppActions
}

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

  const uiSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const systemSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestSystemRef = useRef<System | null>(null)

  useEffect(() => {
    latestSystemRef.current = state.system
  }, [state.system])

  const scheduleUiSave = useCallback(
    (nextSystem: System) => {
      latestSystemRef.current = nextSystem
      if (uiSaveTimer.current) clearTimeout(uiSaveTimer.current)
      uiSaveTimer.current = setTimeout(async () => {
        uiSaveTimer.current = null
        const latest = latestSystemRef.current
        if (!latest) return
        try {
          await store.saveUi(latest)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          dispatch({ type: 'SET_ERROR', error: message })
        }
      }, 200)
    },
    [store]
  )

  const scheduleSystemSave = useCallback(
    (nextSystem: System) => {
      latestSystemRef.current = nextSystem
      if (systemSaveTimer.current) clearTimeout(systemSaveTimer.current)
      systemSaveTimer.current = setTimeout(async () => {
        systemSaveTimer.current = null
        const latest = latestSystemRef.current
        if (!latest) return
        try {
          await store.save(latest)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          dispatch({ type: 'SET_ERROR', error: message })
        }
      }, 250)
    },
    [store]
  )

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
      const trimmedName = name.trim()
      const node = state.system.nodes[nodeId]
      const nameError = validateObjectName(trimmedName, getNodeLabel(node))
      if (nameError) {
        dispatch({ type: 'SET_ERROR', error: nameError })
        return
      }
      const system = renameNode(state.system, nodeId, trimmedName)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleSystemSave(system)
    },
    [scheduleSystemSave, state.system]
  )

  const toggleVisibilityAction = useCallback(
    (nodeId: string) => {
      if (!state.system) return
      const system = toggleNodeVisibility(state.system, nodeId)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const toggleExpandedAction = useCallback(
    (nodeId: string) => {
      if (!state.system) return
      const system = toggleNodeExpanded(state.system, nodeId)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const moveNodeAction = useCallback(
    (nodeId: string, direction: 'up' | 'down') => {
      if (!state.system) return
      const system = moveNode(state.system, nodeId, direction)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const reorderNodeAction = useCallback(
    (nodeId: string, targetId: string) => {
      if (!state.system) return
      const system = reorderNode(state.system, nodeId, targetId)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const updateLayoutAction = useCallback(
    (layout: Partial<System['ui']['layout']>) => {
      if (!state.system) return
      const system = updateLayout(state.system, layout)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const updateViewportHeightAction = useCallback(
    (nodeId: string, height: number) => {
      if (!state.system || !Number.isFinite(height)) return
      const system = updateViewportHeights(state.system, { [nodeId]: height })
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const updateRenderAction = useCallback(
    (nodeId: string, render: Partial<TreeNode['render']>) => {
      if (!state.system) return
      const system = updateNodeRender(state.system, nodeId, render)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const updateSceneAction = useCallback(
    (sceneId: string, update: Partial<Omit<Scene, 'id' | 'name'>>) => {
      if (!state.system) return
      const system = updateScene(state.system, sceneId, update)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const updateBifurcationDiagramAction = useCallback(
    (diagramId: string, update: Partial<Omit<BifurcationDiagram, 'id' | 'name'>>) => {
      if (!state.system) return
      const system = updateBifurcationDiagram(state.system, diagramId, update)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
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
        const nameError = validateObjectName(trimmedName, 'Orbit')
        if (nameError) {
          throw new Error(nameError)
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

  const sampleMap1DFunction = useCallback(
    async (request: SampleMap1DFunctionRequest, opts?: { signal?: AbortSignal }) => {
      try {
        return await client.sampleMap1DFunction(request, opts)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw err
        }
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
        throw err
      }
    },
    [client]
  )

  const computeLyapunovExponents = useCallback(
    async (request: OrbitLyapunovRequest) => {
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
          throw new Error('Select a valid orbit to analyze.')
        }
        if (!orbit.data || orbit.data.length < 2) {
          throw new Error('Run an orbit before computing Lyapunov exponents.')
        }

        const duration = orbit.t_end - orbit.t_start
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error('Orbit has no duration to analyze.')
        }

        const dt = orbit.dt || (system.type === 'map' ? 1 : 0.01)
        if (!Number.isFinite(dt) || dt <= 0) {
          throw new Error('Invalid step size detected for this orbit.')
        }

        if (!Number.isFinite(request.transient) || request.transient < 0) {
          throw new Error('Transient time must be non-negative.')
        }
        if (!Number.isFinite(request.qrStride) || request.qrStride <= 0) {
          throw new Error('QR stride must be a positive integer.')
        }

        const transient = Math.min(Math.max(request.transient, 0), duration)
        const targetTime = orbit.t_start + transient

        let startIndex = orbit.data.length - 1
        for (let i = 0; i < orbit.data.length; i += 1) {
          if (orbit.data[i][0] >= targetTime) {
            startIndex = i
            break
          }
        }

        if (startIndex >= orbit.data.length - 1) {
          throw new Error('Transient leaves no data to analyze.')
        }

        const steps = orbit.data.length - startIndex - 1
        const qrStride = Math.max(Math.trunc(request.qrStride), 1)
        const startState = orbit.data[startIndex].slice(1)
        const startTime = orbit.data[startIndex][0]

        const payload: CoreLyapunovExponentsRequest = {
          system,
          startState,
          startTime,
          steps,
          dt,
          qrStride,
        }
        const exponents = await client.computeLyapunovExponents(payload)
        const updated = updateObject(state.system, request.orbitId, {
          lyapunovExponents: exponents,
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

  const computeCovariantLyapunovVectors = useCallback(
    async (request: OrbitCovariantLyapunovRequest) => {
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
          throw new Error('Select a valid orbit to analyze.')
        }
        if (!orbit.data || orbit.data.length < 2) {
          throw new Error('Run an orbit before computing covariant vectors.')
        }

        const duration = orbit.t_end - orbit.t_start
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error('Orbit has no duration to analyze.')
        }

        const dt = orbit.dt || (system.type === 'map' ? 1 : 0.01)
        if (!Number.isFinite(dt) || dt <= 0) {
          throw new Error('Invalid step size detected for this orbit.')
        }

        if (!Number.isFinite(request.transient) || request.transient < 0) {
          throw new Error('Transient time must be non-negative.')
        }
        if (!Number.isFinite(request.forward) || request.forward < 0) {
          throw new Error('Forward transient must be non-negative.')
        }
        if (!Number.isFinite(request.backward) || request.backward < 0) {
          throw new Error('Backward transient must be non-negative.')
        }
        if (!Number.isFinite(request.qrStride) || request.qrStride <= 0) {
          throw new Error('QR stride must be a positive integer.')
        }

        const transient = Math.min(Math.max(request.transient, 0), duration)
        const totalAvailable = duration - transient
        if (totalAvailable <= 0) {
          throw new Error('Transient leaves no data to analyze.')
        }

        const forwardTime = Math.max(Math.min(request.forward, totalAvailable - dt), 0)
        const backwardTime = Math.max(request.backward, 0)
        const qrStride = Math.max(Math.trunc(request.qrStride), 1)

        if (transient + forwardTime + backwardTime >= duration) {
          throw new Error('Transient windows exceed the trajectory duration.')
        }

        const targetTime = orbit.t_start + transient
        let startIndex = orbit.data.length - 1
        for (let i = 0; i < orbit.data.length; i += 1) {
          if (orbit.data[i][0] >= targetTime) {
            startIndex = i
            break
          }
        }
        if (startIndex >= orbit.data.length - 1) {
          throw new Error('Transient leaves no data to analyze.')
        }

        const stepsAvailable = orbit.data.length - startIndex - 1
        if (stepsAvailable <= 0) {
          throw new Error('Not enough samples beyond the transient point.')
        }

        const forwardSteps = Math.min(
          Math.max(Math.floor(forwardTime / dt), 0),
          Math.max(stepsAvailable - 1, 0)
        )
        if (forwardSteps >= stepsAvailable) {
          throw new Error('Forward transient exceeds available samples.')
        }

        const windowSteps = Math.max(stepsAvailable - forwardSteps, 0)
        if (windowSteps === 0) {
          throw new Error('No samples remain for the analysis window.')
        }

        const backwardSteps = Math.max(Math.floor(backwardTime / dt), 0)
        const startState = orbit.data[startIndex].slice(1)
        const startTime = orbit.data[startIndex][0]

        const payload: CoreCovariantLyapunovRequest = {
          system,
          startState,
          startTime,
          windowSteps,
          dt,
          qrStride,
          forwardTransient: forwardSteps,
          backwardTransient: backwardSteps,
        }

        const response = await client.computeCovariantLyapunovVectors(payload)
        const covariantVectors = reshapeCovariantVectors(response)
        const updated = updateObject(state.system, request.orbitId, {
          covariantVectors,
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
        const nameError = validateObjectName(trimmedName, 'Equilibrium')
        if (nameError) {
          throw new Error(nameError)
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

  const createEquilibriumBranch = useCallback(
    async (request: EquilibriumContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.paramNames.length === 0) {
          throw new Error('System has no parameters to continue.')
        }
        const equilibrium = state.system.objects[request.equilibriumId]
        if (!equilibrium || equilibrium.type !== 'equilibrium') {
          throw new Error('Select a valid equilibrium to continue.')
        }
        if (!equilibrium.solution) {
          throw new Error('Solve the equilibrium before continuing.')
        }

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, equilibrium.name, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }
        if (!system.paramNames.includes(request.parameterName)) {
          throw new Error('Select a valid continuation parameter.')
        }

        const runConfig: SystemConfig = { ...system }
        if (
          equilibrium.parameters &&
          equilibrium.parameters.length === system.params.length
        ) {
          runConfig.params = [...equilibrium.parameters]
        }

        const branchData = await client.runEquilibriumContinuation(
          {
            system: runConfig,
            equilibriumState: equilibrium.solution.state,
            parameterName: request.parameterName,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Equilibrium continuation', progress },
              }),
          }
        )

        const normalized = normalizeBranchEigenvalues(branchData)
        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: request.parameterName,
          parentObject: equilibrium.name,
          startObject: equilibrium.name,
          branchType: 'equilibrium',
          data: normalized,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...runConfig.params],
        }

        const parentNodeId = findObjectIdByName(state.system, equilibrium.name)
        if (!parentNodeId) {
          throw new Error('Unable to locate the parent equilibrium in the tree.')
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const selected = selectNode(created.system, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createBranchFromPoint = useCallback(
    async (request: BranchContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.paramNames.length === 0) {
          throw new Error('System has no parameters to continue.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'equilibrium') {
          throw new Error('Branch continuation is only available for equilibrium branches.')
        }

        const point: ContinuationPoint | undefined =
          sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, sourceBranch.parentObject, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }
        if (!system.paramNames.includes(request.parameterName)) {
          throw new Error('Select a valid continuation parameter.')
        }

        const runConfig: SystemConfig = { ...system }
        runConfig.params = getBranchParams(state.system, sourceBranch)

        const sourceParamIdx = system.paramNames.indexOf(sourceBranch.parameterName)
        if (sourceParamIdx >= 0) {
          runConfig.params[sourceParamIdx] = point.param_value
        }

        const branchData = await client.runEquilibriumContinuation(
          {
            system: runConfig,
            equilibriumState: point.state,
            parameterName: request.parameterName,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Equilibrium continuation', progress },
              }),
          }
        )

        const normalized = normalizeBranchEigenvalues(branchData)
        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: request.parameterName,
          parentObject: sourceBranch.parentObject,
          startObject: sourceBranch.name,
          branchType: 'equilibrium',
          data: normalized,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...runConfig.params],
        }

        const parentNodeId = findObjectIdByName(state.system, sourceBranch.parentObject)
        if (!parentNodeId) {
          throw new Error('Unable to locate the parent equilibrium in the tree.')
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const selected = selectNode(created.system, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const extendBranch = useCallback(
    async (request: BranchExtensionRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to extend.')
        }
        if (
          ![
            'equilibrium',
            'limit_cycle',
            'fold_curve',
            'hopf_curve',
            'lpc_curve',
            'pd_curve',
            'ns_curve',
          ].includes(sourceBranch.branchType)
        ) {
          throw new Error(
            'Branch extension is only available for equilibrium, limit cycle, or bifurcation curve branches.'
          )
        }
        if (!sourceBranch.data.points.length) {
          throw new Error('Branch has no points to extend.')
        }

        const runConfig: SystemConfig = { ...system }
        runConfig.params = getBranchParams(state.system, sourceBranch)

        const branchData = serializeBranchDataForWasm(sourceBranch)

        const updatedData = await client.runContinuationExtension(
          {
            system: runConfig,
            branchData,
            parameterName: sourceBranch.parameterName,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Extension', progress },
              }),
          }
        )

        const normalized = normalizeBranchEigenvalues(updatedData)
        const updatedBranch: ContinuationObject = {
          ...sourceBranch,
          data: normalized,
          settings: request.settings,
        }

        const updated = updateBranch(state.system, request.branchId, updatedBranch)
        const selected = selectNode(updated, request.branchId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createFoldCurveFromPoint = useCallback(
    async (request: FoldCurveContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.paramNames.length < 2) {
          throw new Error('Two-parameter continuation requires at least 2 parameters.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'equilibrium') {
          throw new Error('Fold curve continuation is only available for equilibrium branches.')
        }

        const point: ContinuationPoint | undefined =
          sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }
        if (point.stability !== 'Fold') {
          throw new Error('Selected point is not a Fold bifurcation.')
        }

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, sourceBranch.parentObject, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }

        const param1Name = sourceBranch.parameterName
        if (!system.paramNames.includes(param1Name)) {
          throw new Error('Source continuation parameter is not defined in this system.')
        }

        const param2Name = request.param2Name
        if (!system.paramNames.includes(param2Name)) {
          throw new Error('Select a valid second continuation parameter.')
        }
        if (param2Name === param1Name) {
          throw new Error('Second parameter must be different from the continuation parameter.')
        }

        const runConfig: SystemConfig = { ...system }
        runConfig.params = getBranchParams(state.system, sourceBranch)

        const param1Idx = system.paramNames.indexOf(param1Name)
        if (param1Idx >= 0) {
          runConfig.params[param1Idx] = point.param_value
        }

        const param2Idx = system.paramNames.indexOf(param2Name)
        if (param2Idx < 0) {
          throw new Error('Select a valid second continuation parameter.')
        }
        const param2Value = runConfig.params[param2Idx]

        const curveData = await client.runFoldCurveContinuation(
          {
            system: runConfig,
            foldState: point.state,
            param1Name,
            param1Value: point.param_value,
            param2Name,
            param2Value,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Fold Curve', progress },
              }),
          }
        )
        if (curveData.points.length <= 1) {
          throw new Error(
            'Fold curve continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const branchData = normalizeBranchEigenvalues({
          points: curveData.points.map((pt) => ({
            state: pt.state || point.state,
            param_value: pt.param1_value,
            param2_value: pt.param2_value,
            stability: pt.codim2_type || 'None',
            eigenvalues: normalizeEigenvalueArray(pt.eigenvalues),
          })),
          bifurcations: curveData.codim2_bifurcations?.map((b) => b.index) || [],
          indices: curveData.points.map((_, i) => i),
          branch_type: {
            type: 'FoldCurve' as const,
            param1_name: param1Name,
            param2_name: param2Name,
          },
        })

        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: `${param1Name}, ${param2Name}`,
          parentObject: sourceBranch.parentObject,
          startObject: sourceBranch.name,
          branchType: 'fold_curve',
          data: branchData,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...runConfig.params],
        }

        const parentNodeId = findObjectIdByName(state.system, sourceBranch.parentObject)
        if (!parentNodeId) {
          throw new Error('Unable to locate the parent equilibrium in the tree.')
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const selected = selectNode(created.system, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createHopfCurveFromPoint = useCallback(
    async (request: HopfCurveContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.paramNames.length < 2) {
          throw new Error('Two-parameter continuation requires at least 2 parameters.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'equilibrium') {
          throw new Error('Hopf curve continuation is only available for equilibrium branches.')
        }

        const point: ContinuationPoint | undefined =
          sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }
        if (point.stability !== 'Hopf') {
          throw new Error('Selected point is not a Hopf bifurcation.')
        }

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, sourceBranch.parentObject, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }

        const param1Name = sourceBranch.parameterName
        if (!system.paramNames.includes(param1Name)) {
          throw new Error('Source continuation parameter is not defined in this system.')
        }

        const param2Name = request.param2Name
        if (!system.paramNames.includes(param2Name)) {
          throw new Error('Select a valid second continuation parameter.')
        }
        if (param2Name === param1Name) {
          throw new Error('Second parameter must be different from the continuation parameter.')
        }

        const runConfig: SystemConfig = { ...system }
        runConfig.params = getBranchParams(state.system, sourceBranch)

        const param1Idx = system.paramNames.indexOf(param1Name)
        if (param1Idx >= 0) {
          runConfig.params[param1Idx] = point.param_value
        }

        const param2Idx = system.paramNames.indexOf(param2Name)
        if (param2Idx < 0) {
          throw new Error('Select a valid second continuation parameter.')
        }
        const param2Value = runConfig.params[param2Idx]
        const hopfOmega = extractHopfOmega(point)

        const curveData = await client.runHopfCurveContinuation(
          {
            system: runConfig,
            hopfState: point.state,
            hopfOmega,
            param1Name,
            param1Value: point.param_value,
            param2Name,
            param2Value,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Hopf Curve', progress },
              }),
          }
        )
        if (curveData.points.length <= 1) {
          throw new Error(
            'Hopf curve continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const branchData = normalizeBranchEigenvalues({
          points: curveData.points.map((pt) => ({
            state: pt.state || point.state,
            param_value: pt.param1_value,
            param2_value: pt.param2_value,
            stability: pt.codim2_type || 'None',
            eigenvalues: normalizeEigenvalueArray(pt.eigenvalues),
            auxiliary: pt.auxiliary ?? undefined,
          })),
          bifurcations: curveData.codim2_bifurcations?.map((b) => b.index) || [],
          indices: curveData.points.map((_, i) => i),
          branch_type: {
            type: 'HopfCurve' as const,
            param1_name: param1Name,
            param2_name: param2Name,
          },
        })

        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: `${param1Name}, ${param2Name}`,
          parentObject: sourceBranch.parentObject,
          startObject: sourceBranch.name,
          branchType: 'hopf_curve',
          data: branchData,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...runConfig.params],
        }

        const parentNodeId = findObjectIdByName(state.system, sourceBranch.parentObject)
        if (!parentNodeId) {
          throw new Error('Unable to locate the parent equilibrium in the tree.')
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const selected = selectNode(created.system, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createLimitCycleFromHopf = useCallback(
    async (request: LimitCycleHopfContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type === 'map') {
          throw new Error('Limit cycles require a flow system.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'equilibrium') {
          throw new Error('Limit cycle continuation is only available for equilibrium branches.')
        }

        const point: ContinuationPoint | undefined =
          sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }
        if (point.stability !== 'Hopf') {
          throw new Error('Selected point is not a Hopf bifurcation.')
        }

        const limitCycleName = request.limitCycleName.trim()
        const limitCycleNameError = validateObjectName(limitCycleName, 'Limit cycle')
        if (limitCycleNameError) {
          throw new Error(limitCycleNameError)
        }
        const existingNames = Object.values(state.system.objects).map((obj) => obj.name)
        if (existingNames.includes(limitCycleName)) {
          throw new Error(`Object "${limitCycleName}" already exists.`)
        }

        const branchName = request.branchName.trim()
        const branchNameError = validateBranchName(branchName)
        if (branchNameError) {
          throw new Error(branchNameError)
        }
        if (branchNameExists(state.system, limitCycleName, branchName)) {
          throw new Error(`Branch "${branchName}" already exists.`)
        }

        if (!Number.isFinite(request.amplitude) || request.amplitude <= 0) {
          throw new Error('Amplitude must be a positive number.')
        }
        if (!Number.isFinite(request.ntst) || request.ntst <= 0) {
          throw new Error('NTST must be a positive integer.')
        }
        if (!Number.isFinite(request.ncol) || request.ncol <= 0) {
          throw new Error('NCOL must be a positive integer.')
        }

        const parameterName = sourceBranch.parameterName
        if (!system.paramNames.includes(parameterName)) {
          throw new Error('Continuation parameter is not defined in this system.')
        }

        const runConfig: SystemConfig = { ...system }
        runConfig.params = getBranchParams(state.system, sourceBranch)

        const paramIndex = system.paramNames.indexOf(parameterName)
        if (paramIndex >= 0) {
          runConfig.params[paramIndex] = point.param_value
        }

        const branchData = await client.runLimitCycleContinuationFromHopf(
          {
            system: runConfig,
            hopfState: point.state,
            parameterName,
            paramValue: point.param_value,
            amplitude: request.amplitude,
            ntst: Math.round(request.ntst),
            ncol: Math.round(request.ncol),
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Limit Cycle', progress },
              }),
          }
        )

        if (branchData.points.length <= 1) {
          throw new Error(
            'Limit cycle continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const indices =
          branchData.indices && branchData.indices.length === branchData.points.length
            ? branchData.indices
            : branchData.points.map((_, index) => index)

        const normalizedBranchData = normalizeBranchEigenvalues({
          ...branchData,
          indices,
          branch_type:
            branchData.branch_type ?? {
              type: 'LimitCycle' as const,
              ntst: Math.round(request.ntst),
              ncol: Math.round(request.ncol),
            },
        })

        const firstPoint = normalizedBranchData.points[0]
        if (!firstPoint || firstPoint.state.length === 0) {
          throw new Error('Limit cycle continuation did not return a valid initial state.')
        }

        const period = firstPoint.state[firstPoint.state.length - 1]
        if (!Number.isFinite(period) || period <= 0) {
          throw new Error('Limit cycle continuation returned an invalid period.')
        }

        const logicalIndex =
          sourceBranch.data.indices?.[request.pointIndex] ?? request.pointIndex

        const lcObj: LimitCycleObject = {
          type: 'limit_cycle',
          name: limitCycleName,
          systemName: system.name,
          origin: {
            type: 'hopf',
            equilibriumObjectName: sourceBranch.parentObject,
            equilibriumBranchName: sourceBranch.name,
            pointIndex: logicalIndex,
          },
          ntst: Math.round(request.ntst),
          ncol: Math.round(request.ncol),
          period,
          state: firstPoint.state,
          parameters: [...runConfig.params],
          parameterName,
          paramValue: firstPoint.param_value,
          createdAt: new Date().toISOString(),
        }

        const added = addObject(state.system, lcObj)
        const branch: ContinuationObject = {
          type: 'continuation',
          name: branchName,
          systemName: system.name,
          parameterName,
          parentObject: limitCycleName,
          startObject: limitCycleName,
          branchType: 'limit_cycle',
          data: normalizedBranchData,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...runConfig.params],
        }

        const createdBranch = addBranch(added.system, branch, added.nodeId)
        const selected = selectNode(createdBranch.system, createdBranch.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createLimitCycleFromOrbit = useCallback(
    async (request: LimitCycleOrbitContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type === 'map') {
          throw new Error('Limit cycles require a flow system.')
        }

        const orbit = state.system.objects[request.orbitId]
        if (!orbit || orbit.type !== 'orbit') {
          throw new Error('Select a valid orbit for limit cycle continuation.')
        }
        if (orbit.data.length === 0) {
          throw new Error('Orbit has no data to continue.')
        }

        if (system.paramNames.length === 0) {
          throw new Error('Add a parameter before continuing.')
        }

        const limitCycleName = request.limitCycleName.trim()
        const limitCycleNameError = validateObjectName(limitCycleName, 'Limit cycle')
        if (limitCycleNameError) {
          throw new Error(limitCycleNameError)
        }
        const existingNames = Object.values(state.system.objects).map((obj) => obj.name)
        if (existingNames.includes(limitCycleName)) {
          throw new Error(`Object "${limitCycleName}" already exists.`)
        }

        const branchName = request.branchName.trim()
        const branchNameError = validateBranchName(branchName)
        if (branchNameError) {
          throw new Error(branchNameError)
        }
        if (branchNameExists(state.system, limitCycleName, branchName)) {
          throw new Error(`Branch "${branchName}" already exists.`)
        }

        if (!Number.isFinite(request.tolerance) || request.tolerance <= 0) {
          throw new Error('Tolerance must be a positive number.')
        }
        if (!Number.isFinite(request.ntst) || request.ntst <= 0) {
          throw new Error('NTST must be a positive integer.')
        }
        if (!Number.isFinite(request.ncol) || request.ncol <= 0) {
          throw new Error('NCOL must be a positive integer.')
        }

        const parameterName = request.parameterName
        if (!system.paramNames.includes(parameterName)) {
          throw new Error('Continuation parameter is not defined in this system.')
        }

        const runConfig: SystemConfig = { ...system }
        if (orbit.parameters && orbit.parameters.length === system.params.length) {
          runConfig.params = [...orbit.parameters]
        }

        const paramIndex = system.paramNames.indexOf(parameterName)
        if (paramIndex < 0) {
          throw new Error('Continuation parameter is not defined in this system.')
        }
        const paramValue = runConfig.params[paramIndex]

        const orbitTimes = orbit.data.map((entry) => entry[0])
        const orbitStates = orbit.data.map((entry) => entry.slice(1))

        const branchData = await client.runLimitCycleContinuationFromOrbit(
          {
            system: runConfig,
            orbitTimes,
            orbitStates,
            parameterName,
            paramValue,
            tolerance: request.tolerance,
            ntst: Math.round(request.ntst),
            ncol: Math.round(request.ncol),
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Limit Cycle', progress },
              }),
          }
        )

        if (branchData.points.length <= 1) {
          throw new Error(
            'Limit cycle continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const indices =
          branchData.indices && branchData.indices.length === branchData.points.length
            ? branchData.indices
            : branchData.points.map((_, index) => index)

        const normalizedBranchData = normalizeBranchEigenvalues({
          ...branchData,
          indices,
          branch_type:
            branchData.branch_type ?? {
              type: 'LimitCycle' as const,
              ntst: Math.round(request.ntst),
              ncol: Math.round(request.ncol),
            },
        })

        const firstPoint = normalizedBranchData.points[0]
        if (!firstPoint || firstPoint.state.length === 0) {
          throw new Error('Limit cycle continuation did not return a valid initial state.')
        }

        const period = firstPoint.state[firstPoint.state.length - 1]
        if (!Number.isFinite(period) || period <= 0) {
          throw new Error('Limit cycle continuation returned an invalid period.')
        }

        const lcObj: LimitCycleObject = {
          type: 'limit_cycle',
          name: limitCycleName,
          systemName: system.name,
          origin: { type: 'orbit', orbitName: orbit.name },
          ntst: Math.round(request.ntst),
          ncol: Math.round(request.ncol),
          period,
          state: firstPoint.state,
          parameters: [...runConfig.params],
          parameterName,
          paramValue: firstPoint.param_value,
          floquetMultipliers: firstPoint.eigenvalues,
          createdAt: new Date().toISOString(),
        }

        const added = addObject(state.system, lcObj)
        const branch: ContinuationObject = {
          type: 'continuation',
          name: branchName,
          systemName: system.name,
          parameterName,
          parentObject: limitCycleName,
          startObject: orbit.name,
          branchType: 'limit_cycle',
          data: normalizedBranchData,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...runConfig.params],
        }

        const createdBranch = addBranch(added.system, branch, added.nodeId)
        const selected = selectNode(createdBranch.system, createdBranch.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createLimitCycleFromPD = useCallback(
    async (request: LimitCyclePDContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type === 'map') {
          throw new Error('Limit cycles require a flow system.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'limit_cycle') {
          throw new Error(
            'Period-doubling branching is only available for limit cycle branches.'
          )
        }

        const point = sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }
        if (point.stability !== 'PeriodDoubling') {
          throw new Error('Selected point is not a Period Doubling bifurcation.')
        }

        const limitCycleName = request.limitCycleName.trim()
        const limitCycleNameError = validateObjectName(limitCycleName, 'Limit cycle')
        if (limitCycleNameError) {
          throw new Error(limitCycleNameError)
        }
        const existingNames = Object.values(state.system.objects).map((obj) => obj.name)
        if (existingNames.includes(limitCycleName)) {
          throw new Error(`Object "${limitCycleName}" already exists.`)
        }

        const branchName = request.branchName.trim()
        const branchNameError = validateBranchName(branchName)
        if (branchNameError) {
          throw new Error(branchNameError)
        }
        if (branchNameExists(state.system, limitCycleName, branchName)) {
          throw new Error(`Branch "${branchName}" already exists.`)
        }

        if (!Number.isFinite(request.amplitude) || request.amplitude <= 0) {
          throw new Error('Amplitude must be a positive number.')
        }
        if (!Number.isFinite(request.ncol) || request.ncol <= 0) {
          throw new Error('NCOL must be a positive integer.')
        }

        const parameterName = sourceBranch.parameterName
        if (!system.paramNames.includes(parameterName)) {
          throw new Error('Continuation parameter is not defined in this system.')
        }

        let sourceNtst = 20
        const branchType = sourceBranch.data.branch_type
        if (branchType?.type === 'LimitCycle') {
          sourceNtst = branchType.ntst
        }

        const runConfig: SystemConfig = { ...system }
        runConfig.params = getBranchParams(state.system, sourceBranch)

        const paramIndex = system.paramNames.indexOf(parameterName)
        if (paramIndex >= 0) {
          runConfig.params[paramIndex] = point.param_value
        }

        const branchData = await client.runLimitCycleContinuationFromPD(
          {
            system: runConfig,
            lcState: point.state,
            parameterName,
            paramValue: point.param_value,
            ntst: Math.round(sourceNtst),
            ncol: Math.round(request.ncol),
            amplitude: request.amplitude,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Limit Cycle', progress },
              }),
          }
        )

        if (branchData.points.length <= 1) {
          throw new Error(
            'Limit cycle continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const indices =
          branchData.indices && branchData.indices.length === branchData.points.length
            ? branchData.indices
            : branchData.points.map((_, index) => index)

        const normalizedBranchData = normalizeBranchEigenvalues({
          ...branchData,
          indices,
          branch_type:
            branchData.branch_type ?? {
              type: 'LimitCycle' as const,
              ntst: Math.round(sourceNtst * 2),
              ncol: Math.round(request.ncol),
            },
        })

        const firstPoint = normalizedBranchData.points[0]
        if (!firstPoint || firstPoint.state.length === 0) {
          throw new Error('Limit cycle continuation did not return a valid initial state.')
        }

        const period = firstPoint.state[firstPoint.state.length - 1]
        if (!Number.isFinite(period) || period <= 0) {
          throw new Error('Limit cycle continuation returned an invalid period.')
        }

        let objNtst = Math.round(sourceNtst * 2)
        let objNcol = Math.round(request.ncol)
        const normalizedType = normalizedBranchData.branch_type
        if (normalizedType?.type === 'LimitCycle') {
          objNtst = normalizedType.ntst
          objNcol = normalizedType.ncol
        }

        const lcObj: LimitCycleObject = {
          type: 'limit_cycle',
          name: limitCycleName,
          systemName: system.name,
          origin: {
            type: 'pd',
            sourceLimitCycleObjectName: sourceBranch.parentObject,
            sourceBranchName: sourceBranch.name,
            pointIndex: request.pointIndex,
          },
          ntst: objNtst,
          ncol: objNcol,
          period,
          state: firstPoint.state,
          parameters: [...runConfig.params],
          parameterName,
          paramValue: firstPoint.param_value,
          floquetMultipliers: firstPoint.eigenvalues,
          createdAt: new Date().toISOString(),
        }

        const added = addObject(state.system, lcObj)
        const branch: ContinuationObject = {
          type: 'continuation',
          name: branchName,
          systemName: system.name,
          parameterName,
          parentObject: limitCycleName,
          startObject: sourceBranch.name,
          branchType: 'limit_cycle',
          data: normalizedBranchData,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...runConfig.params],
        }

        const createdBranch = addBranch(added.system, branch, added.nodeId)
        const selected = selectNode(createdBranch.system, createdBranch.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
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
        const nameError = validateObjectName(trimmedName, 'Limit cycle')
        if (nameError) {
          throw new Error(nameError)
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
    async (name: string, targetId?: string | null) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const trimmedName = name.trim()
        const nameError = validateObjectName(trimmedName, 'Scene')
        if (nameError) {
          throw new Error(nameError)
        }
        const created = addScene(state.system, trimmedName)
        const updated =
          targetId && targetId !== created.nodeId
            ? reorderNode(created.system, created.nodeId, targetId)
            : created.system
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.saveUi(updated)
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
    async (name: string, targetId?: string | null) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const trimmedName = name.trim()
        const nameError = validateObjectName(trimmedName, 'Bifurcation diagram')
        if (nameError) {
          throw new Error(nameError)
        }
        const created = addBifurcationDiagram(state.system, trimmedName)
        const updated =
          targetId && targetId !== created.nodeId
            ? reorderNode(created.system, created.nodeId, targetId)
            : created.system
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.saveUi(updated)
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
      updateViewportHeight: updateViewportHeightAction,
      updateRender: updateRenderAction,
      updateScene: updateSceneAction,
      updateBifurcationDiagram: updateBifurcationDiagramAction,
      deleteNode: deleteNodeAction,
      createOrbitObject,
      createEquilibriumObject,
      runOrbit,
      sampleMap1DFunction,
      computeLyapunovExponents,
      computeCovariantLyapunovVectors,
      solveEquilibrium,
      createEquilibriumBranch,
      createBranchFromPoint,
      extendBranch,
      createFoldCurveFromPoint,
      createHopfCurveFromPoint,
      createLimitCycleObject,
      createLimitCycleFromOrbit,
      createLimitCycleFromHopf,
      createLimitCycleFromPD,
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
      sampleMap1DFunction,
      computeLyapunovExponents,
      computeCovariantLyapunovVectors,
      solveEquilibrium,
      createEquilibriumBranch,
      createBranchFromPoint,
      extendBranch,
      createFoldCurveFromPoint,
      createHopfCurveFromPoint,
      createLimitCycleFromHopf,
      createLimitCycleFromOrbit,
      createLimitCycleFromPD,
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
      updateViewportHeightAction,
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
