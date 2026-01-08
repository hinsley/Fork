import type { EquilibriumSolution, SystemConfig } from '../system/types'

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

export interface ForkCoreClient {
  simulateOrbit(
    request: SimulateOrbitRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SimulateOrbitResult>
  solveEquilibrium(
    request: SolveEquilibriumRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SolveEquilibriumResult>
  validateSystem(
    request: ValidateSystemRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<ValidateSystemResult>
  close?: () => Promise<void>
}
