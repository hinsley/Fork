import type {
  ContinuationBranchData,
  ContinuationSettings,
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
}

export type SolveEquilibriumResult = EquilibriumSolution

export type EquilibriumContinuationRequest = {
  system: SystemConfig
  equilibriumState: number[]
  parameterName: string
  settings: ContinuationSettings
  forward: boolean
}

export type EquilibriumContinuationResult = ContinuationBranchData

export interface ForkCoreClient {
  simulateOrbit(
    request: SimulateOrbitRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SimulateOrbitResult>
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
  validateSystem(
    request: ValidateSystemRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<ValidateSystemResult>
  close?: () => Promise<void>
}
