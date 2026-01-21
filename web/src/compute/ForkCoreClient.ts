import type {
  ContinuationBranchData,
  ContinuationSettings,
  ContinuationPoint,
  EquilibriumSolution,
  SystemConfig,
} from '../system/types'

export type ContinuationProgress = {
  done: boolean
  current_step: number
  max_steps: number
  points_computed: number
  bifurcations_found: number
  current_param: number
}

export type SimulateOrbitRequest = {
  system: SystemConfig
  initialState: number[]
  steps: number
  dt: number
}

export type SimulateOrbitResult = {
  data: number[][]
  t_start: number
  t_end: number
  dt: number
}

export type SampleMap1DFunctionRequest = {
  system: SystemConfig
  min: number
  max: number
  samples: number
}

export type SampleMap1DFunctionResult = {
  x: number[]
  y: number[]
}

export type LyapunovExponentsRequest = {
  system: SystemConfig
  startState: number[]
  startTime: number
  steps: number
  dt: number
  qrStride: number
}

export type CovariantLyapunovRequest = {
  system: SystemConfig
  startState: number[]
  startTime: number
  windowSteps: number
  dt: number
  qrStride: number
  forwardTransient: number
  backwardTransient: number
}

export type CovariantLyapunovResponse = {
  dimension: number
  checkpoints: number
  times: number[]
  vectors: number[]
}

export type ValidateSystemRequest = {
  system: SystemConfig
}

export type ValidateSystemResult = {
  ok: boolean
  equationErrors: Array<string | null>
  message?: string
}

export type SolveEquilibriumRequest = {
  system: SystemConfig
  initialGuess: number[]
  maxSteps: number
  dampingFactor: number
  mapIterations?: number
}

export type SolveEquilibriumResult = EquilibriumSolution

export type EquilibriumContinuationRequest = {
  system: SystemConfig
  equilibriumState: number[]
  parameterName: string
  mapIterations?: number
  settings: ContinuationSettings
  forward: boolean
}

export type EquilibriumContinuationResult = ContinuationBranchData

export type ContinuationBranchDataWire = Omit<ContinuationBranchData, 'points'> & {
  points: Array<
    Omit<ContinuationPoint, 'eigenvalues'> & {
      eigenvalues: Array<[number, number] | { re?: number; im?: number }>
    }
  >
}

export type ContinuationExtensionRequest = {
  system: SystemConfig
  branchData: ContinuationBranchData | ContinuationBranchDataWire
  parameterName: string
  mapIterations?: number
  settings: ContinuationSettings
  forward: boolean
}

export type ContinuationExtensionResult = ContinuationBranchData

export type Codim1CurvePoint = {
  state: number[]
  param1_value: number
  param2_value: number
  codim2_type?: string
  eigenvalues?: Array<[number, number] | { re?: number; im?: number }>
  auxiliary?: number | null
}

export type Codim1CurveBranch = {
  curve_type?: string
  param1_index?: number
  param2_index?: number
  points: Codim1CurvePoint[]
  codim2_bifurcations?: Array<{ index: number; type?: string }>
  indices?: number[]
}

export type FoldCurveContinuationRequest = {
  system: SystemConfig
  foldState: number[]
  param1Name: string
  param1Value: number
  param2Name: string
  param2Value: number
  mapIterations?: number
  settings: ContinuationSettings
  forward: boolean
}

export type HopfCurveContinuationRequest = {
  system: SystemConfig
  hopfState: number[]
  hopfOmega: number
  param1Name: string
  param1Value: number
  param2Name: string
  param2Value: number
  mapIterations?: number
  settings: ContinuationSettings
  forward: boolean
}

export type LimitCycleContinuationFromHopfRequest = {
  system: SystemConfig
  hopfState: number[]
  parameterName: string
  paramValue: number
  amplitude: number
  ntst: number
  ncol: number
  settings: ContinuationSettings
  forward: boolean
}

export type LimitCycleContinuationFromOrbitRequest = {
  system: SystemConfig
  orbitTimes: number[]
  orbitStates: number[][]
  parameterName: string
  paramValue: number
  tolerance: number
  ntst: number
  ncol: number
  settings: ContinuationSettings
  forward: boolean
}

export type LimitCycleContinuationFromPDRequest = {
  system: SystemConfig
  lcState: number[]
  parameterName: string
  paramValue: number
  ntst: number
  ncol: number
  amplitude: number
  settings: ContinuationSettings
  forward: boolean
}

export type LimitCycleContinuationResult = ContinuationBranchData

export type MapCycleContinuationFromPDRequest = {
  system: SystemConfig
  pdState: number[]
  parameterName: string
  paramValue: number
  mapIterations: number
  amplitude: number
  settings: ContinuationSettings
  forward: boolean
  solverParams?: {
    maxSteps: number
    dampingFactor: number
    mapIterations?: number
  }
}

export type MapCycleContinuationResult = ContinuationBranchData

export interface ForkCoreClient {
  simulateOrbit(
    request: SimulateOrbitRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SimulateOrbitResult>
  sampleMap1DFunction(
    request: SampleMap1DFunctionRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SampleMap1DFunctionResult>
  computeLyapunovExponents(
    request: LyapunovExponentsRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<number[]>
  computeCovariantLyapunovVectors(
    request: CovariantLyapunovRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<CovariantLyapunovResponse>
  solveEquilibrium(
    request: SolveEquilibriumRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SolveEquilibriumResult>
  runEquilibriumContinuation(
    request: EquilibriumContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<EquilibriumContinuationResult>
  runContinuationExtension(
    request: ContinuationExtensionRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<ContinuationExtensionResult>
  runFoldCurveContinuation(
    request: FoldCurveContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim1CurveBranch>
  runHopfCurveContinuation(
    request: HopfCurveContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim1CurveBranch>
  runLimitCycleContinuationFromHopf(
    request: LimitCycleContinuationFromHopfRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<LimitCycleContinuationResult>
  runLimitCycleContinuationFromOrbit(
    request: LimitCycleContinuationFromOrbitRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<LimitCycleContinuationResult>
  runLimitCycleContinuationFromPD(
    request: LimitCycleContinuationFromPDRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<LimitCycleContinuationResult>
  runMapCycleContinuationFromPD(
    request: MapCycleContinuationFromPDRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<MapCycleContinuationResult>
  validateSystem(
    request: ValidateSystemRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<ValidateSystemResult>
  close?: () => Promise<void>
}
