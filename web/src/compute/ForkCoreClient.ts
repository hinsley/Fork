import type {
  ContinuationBranchData,
  ContinuationSettings,
  ContinuationPoint,
  Manifold2DProfile,
  ManifoldStability,
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
  rings_computed?: number
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

export type IsoclineAxisRequest = {
  variableName: string
  min: number
  max: number
  samples: number
}

export type ComputeIsoclineRequest = {
  system: SystemConfig
  expression: string
  level: number
  axes: IsoclineAxisRequest[]
  frozenState: number[]
}

export type ComputeIsoclineResult =
  | {
      geometry: 'points'
      dim: number
      points: number[]
    }
  | {
      geometry: 'segments'
      dim: number
      points: number[]
      segments: number[]
    }
  | {
      geometry: 'triangles'
      dim: number
      points: number[]
      triangles: number[]
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

export type ManifoldTerminationCapsRequest = {
  max_steps: number
  max_points: number
  max_rings: number
  max_vertices: number
  max_time: number
}

export type ManifoldBoundsRequest = {
  min: number[]
  max: number[]
}

export type EquilibriumManifold1DSettingsRequest = {
  stability: ManifoldStability
  direction: 'Plus' | 'Minus' | 'Both'
  eig_index?: number
  eps: number
  target_arclength: number
  integration_dt: number
  caps: ManifoldTerminationCapsRequest
  bounds?: ManifoldBoundsRequest
}

export type EquilibriumManifold2DSettingsRequest = {
  stability: ManifoldStability
  eig_indices?: [number, number]
  profile?: Manifold2DProfile
  initial_radius: number
  leaf_delta: number
  delta_min: number
  ring_points: number
  min_spacing: number
  max_spacing: number
  alpha_min: number
  alpha_max: number
  delta_alpha_min: number
  delta_alpha_max: number
  integration_dt: number
  target_radius: number
  target_arclength: number
  caps: ManifoldTerminationCapsRequest
  bounds?: ManifoldBoundsRequest
}

export type LimitCycleManifold2DSettingsRequest = {
  stability: ManifoldStability
  floquet_index?: number
  profile?: Manifold2DProfile
  initial_radius: number
  leaf_delta: number
  delta_min: number
  ring_points: number
  min_spacing: number
  max_spacing: number
  alpha_min: number
  alpha_max: number
  delta_alpha_min: number
  delta_alpha_max: number
  integration_dt: number
  target_arclength: number
  ntst?: number
  ncol?: number
  caps: ManifoldTerminationCapsRequest
  bounds?: ManifoldBoundsRequest
}

export type EquilibriumManifold1DRequest = {
  system: SystemConfig
  equilibriumState: number[]
  settings: EquilibriumManifold1DSettingsRequest
}

export type EquilibriumManifold1DResult = ContinuationBranchData[]

export type EquilibriumManifold2DRequest = {
  system: SystemConfig
  equilibriumState: number[]
  settings: EquilibriumManifold2DSettingsRequest
}

export type EquilibriumManifold2DResult = ContinuationBranchData

export type LimitCycleManifold2DRequest = {
  system: SystemConfig
  cycleState: number[]
  ntst: number
  ncol: number
  floquetMultipliers: Array<{ re: number; im: number }>
  settings: LimitCycleManifold2DSettingsRequest
}

export type LimitCycleManifold2DResult = ContinuationBranchData

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

export type IsochroneCurveContinuationRequest = {
  system: SystemConfig
  lcState: number[]
  period: number
  param1Name: string
  param1Value: number
  param2Name: string
  param2Value: number
  ntst: number
  ncol: number
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

export type HomoclinicFromLargeCycleRequest = {
  system: SystemConfig
  lcState: number[]
  sourceNtst: number
  sourceNcol: number
  parameterName: string
  param2Name: string
  targetNtst: number
  targetNcol: number
  freeTime: boolean
  freeEps0: boolean
  freeEps1: boolean
  settings: ContinuationSettings
  forward: boolean
}

export type HomoclinicFromHomoclinicRequest = {
  system: SystemConfig
  pointState: number[]
  sourceNtst: number
  sourceNcol: number
  sourceFreeTime: boolean
  sourceFreeEps0: boolean
  sourceFreeEps1: boolean
  sourceFixedTime: number
  sourceFixedEps0: number
  sourceFixedEps1: number
  parameterName: string
  param2Name: string
  targetNtst: number
  targetNcol: number
  freeTime: boolean
  freeEps0: boolean
  freeEps1: boolean
  settings: ContinuationSettings
  forward: boolean
}

export type HomotopySaddleFromEquilibriumRequest = {
  system: SystemConfig
  equilibriumState: number[]
  parameterName: string
  param2Name: string
  ntst: number
  ncol: number
  eps0: number
  eps1: number
  time: number
  eps1Tol: number
  settings: ContinuationSettings
  forward: boolean
}

export type HomoclinicFromHomotopySaddleRequest = {
  system: SystemConfig
  stageDState: number[]
  sourceNtst: number
  sourceNcol: number
  parameterName: string
  param2Name: string
  targetNtst: number
  targetNcol: number
  freeTime: boolean
  freeEps0: boolean
  freeEps1: boolean
  settings: ContinuationSettings
  forward: boolean
}

export type HomoclinicContinuationResult = ContinuationBranchData
export type HomotopySaddleContinuationResult = ContinuationBranchData

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
  computeIsocline(
    request: ComputeIsoclineRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<ComputeIsoclineResult>
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
  runEquilibriumManifold1D(
    request: EquilibriumManifold1DRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<EquilibriumManifold1DResult>
  runEquilibriumManifold2D(
    request: EquilibriumManifold2DRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<EquilibriumManifold2DResult>
  runLimitCycleManifold2D(
    request: LimitCycleManifold2DRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<LimitCycleManifold2DResult>
  runFoldCurveContinuation(
    request: FoldCurveContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim1CurveBranch>
  runHopfCurveContinuation(
    request: HopfCurveContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim1CurveBranch>
  runIsochroneCurveContinuation(
    request: IsochroneCurveContinuationRequest,
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
  runHomoclinicFromLargeCycle(
    request: HomoclinicFromLargeCycleRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<HomoclinicContinuationResult>
  runHomoclinicFromHomoclinic(
    request: HomoclinicFromHomoclinicRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<HomoclinicContinuationResult>
  runHomotopySaddleFromEquilibrium(
    request: HomotopySaddleFromEquilibriumRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<HomotopySaddleContinuationResult>
  runHomoclinicFromHomotopySaddle(
    request: HomoclinicFromHomotopySaddleRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<HomoclinicContinuationResult>
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
