import type {
  ComputeEventSeriesFromOrbitRequest,
  ComputeEventSeriesFromSamplesRequest,
  ComputeIsoclineRequest,
  ComputeIsoclineResult,
  Codim1CurveBranch,
  Codim2BranchSwitchRequest,
  Codim2BranchSwitchResult,
  EventSeriesHit,
  EventSeriesOrderedSample,
  EventSeriesResult,
  ContinuationProgress,
  ContinuationExtensionRequest,
  ContinuationExtensionResult,
  CovariantLyapunovRequest,
  CovariantLyapunovResponse,
  EquilibriumManifold1DRequest,
  EquilibriumManifold1DResult,
  EquilibriumManifold1DExtensionRequest,
  EquilibriumManifold1DExtensionResult,
  EquilibriumManifold2DRequest,
  EquilibriumManifold2DResult,
  EquilibriumContinuationRequest,
  EquilibriumContinuationResult,
  FoldCurveContinuationRequest,
  ForcedPeriodicResponseContinuationRequest,
  ForcedPeriodicResponseContinuationResult,
  ForkCoreClient,
  HomoclinicContinuationResult,
  HomoclinicFromHomoclinicRequest,
  HomoclinicFromHomotopySaddleRequest,
  HomoclinicFromLargeCycleRequest,
  HeteroclinicContinuationResult,
  HeteroclinicFromOrbitRequest,
  HopfCurveContinuationRequest,
  IsoperiodicCurveContinuationRequest,
  HomotopySaddleContinuationResult,
  HomotopySaddleFromEquilibriumRequest,
  LimitCycleContinuationFromHopfRequest,
  LimitCycleCodim1CurveContinuationRequest,
  LimitCycleContinuationFromOrbitRequest,
  LimitCycleContinuationFromPDRequest,
  LimitCycleContinuationResult,
  LimitCycleFloquetModesRequest,
  LimitCycleFloquetModesResult,
  LimitCycleManifold2DRequest,
  LimitCycleManifold2DResult,
  Manifold2DExtensionRequest,
  Manifold2DExtensionResult,
  MapCycleContinuationFromPDRequest,
  NormalFormComputationRequest,
  NormalFormComputationResult,
  PeriodicBranchPointSwitchRequest,
  PeriodicBranchPointSwitchResult,
  LyapunovExponentsRequest,
  SampleMap1DFunctionRequest,
  SampleMap1DFunctionResult,
  SolveEquilibriumRequest,
  SolveEquilibriumResult,
  SolveForcedPeriodicResponseRequest,
  SolveForcedPeriodicResponseResult,
  SimulateOrbitRequest,
  SimulateOrbitResult,
  ValidateSystemRequest,
  ValidateSystemResult,
} from './ForkCoreClient'
import { JobQueue } from './jobQueue'
import { normalizeBranchEigenvalues } from '../system/continuation'
import { isDeterministicMode } from '../utils/determinism'
import {
  DEFAULT_HOMOCLINIC_INTEGRATION_STEPS_PER_SEGMENT,
  DEFAULT_HOMOCLINIC_SHOOTING_INTERVALS,
} from '../system/homoclinicExtras'

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function compileMockExpression(expression: string, argNames: string[]): (...values: number[]) => number {
  return new Function(...argNames, `return (${expression});`) as (...values: number[]) => number
}

function evaluateMockExpression(
  expression: string,
  varNames: string[],
  paramNames: string[],
  state: number[],
  params: number[]
): number {
  const evaluator = compileMockExpression(expression, [...varNames, ...paramNames])
  const values = [
    ...varNames.map((_, index) => state[index] ?? 0),
    ...paramNames.map((_, index) => params[index] ?? 0),
  ]
  const result = evaluator(...values)
  return typeof result === 'number' && Number.isFinite(result) ? result : Number.NaN
}

function interpolateMockState(a: number[], b: number[], tau: number): number[] {
  return a.map((value, index) => value + ((b[index] ?? value) - value) * tau)
}

function matchesMockCrossing(mode: string, prevValue: number, nextValue: number): boolean {
  if (mode === 'cross_up') return prevValue < 0 && nextValue >= 0
  if (mode === 'cross_down') return prevValue > 0 && nextValue <= 0
  if (mode === 'cross_either') {
    return (prevValue < 0 && nextValue >= 0) || (prevValue > 0 && nextValue <= 0)
  }
  return false
}

function buildMockEventSeries(request: ComputeEventSeriesFromSamplesRequest): EventSeriesResult {
  const { system, samples, eventExpression, eventLevel, observableExpressions, mode } = request
  const observables = (state: number[]) =>
    observableExpressions.map((expression) =>
      evaluateMockExpression(expression, system.varNames, system.paramNames, state, system.params)
    )
  if (mode === 'every_iterate') {
    return {
      hits: samples.map((sample, index) => ({
        order: index,
        sample_index: index,
        time: sample.time ?? null,
        state: [...sample.state],
        observable_values: observables(sample.state),
      })),
    }
  }
  const hits: EventSeriesHit[] = []
  for (let index = 1; index < samples.length; index += 1) {
    const prev = samples[index - 1]
    const next = samples[index]
    const prevValue =
      evaluateMockExpression(
        eventExpression,
        system.varNames,
        system.paramNames,
        prev.state,
        system.params
      ) - eventLevel
    const nextValue =
      evaluateMockExpression(
        eventExpression,
        system.varNames,
        system.paramNames,
        next.state,
        system.params
      ) - eventLevel
    if (!matchesMockCrossing(mode, prevValue, nextValue)) continue
    const tau = nextValue === prevValue ? 1 : Math.min(Math.max(-prevValue / (nextValue - prevValue), 0), 1)
    const state = interpolateMockState(prev.state, next.state, tau)
    const time =
      prev.time == null || next.time == null
        ? next.time ?? null
        : prev.time + ((next.time - prev.time) * tau)
    hits.push({
      order: hits.length,
      sample_index: index,
      time,
      state,
      observable_values: observables(state),
    })
  }
  return { hits }
}

export class MockForkCoreClient implements ForkCoreClient {
  private queue: JobQueue
  private delayMs: number

  constructor(delayMs = isDeterministicMode() ? 0 : 5) {
    this.queue = new JobQueue()
    this.delayMs = delayMs
  }

  async simulateOrbit(
    request: SimulateOrbitRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SimulateOrbitResult> {
    const job = this.queue.enqueue(
      'simulateOrbit',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const data: number[][] = []
        const dimension = Math.max(
          1,
          request.system.varNames.length,
          request.initialState.length
        )
        let t = request.initialContext
        const initialState = Array.from(
          { length: dimension },
          (_, index) => request.initialState[index] ?? 0
        )
        data.push([t, ...initialState])
        for (let i = 0; i < request.steps; i += 1) {
          t += request.dt
          const state = Array.from({ length: dimension }, (_, index) => {
            const phase = t + index * 0.7
            if (index % 3 === 0) return Math.cos(phase)
            if (index % 3 === 1) return Math.sin(phase)
            return Math.cos(phase * 0.5)
          })
          data.push([t, ...state])
        }
        return {
          data,
          t_start: request.initialContext,
          t_end: t,
          dt: request.dt,
        }
      },
      opts
    )
    return await job.promise
  }

  async sampleMap1DFunction(
    request: SampleMap1DFunctionRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SampleMap1DFunctionResult> {
    const job = this.queue.enqueue(
      'sampleMap1DFunction',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const min = Math.min(request.min, request.max)
        const max = Math.max(request.min, request.max)
        if (!Number.isFinite(min) || !Number.isFinite(max)) {
          return { x: [], y: [] }
        }

        const sampleCount = Math.max(1, Math.floor(request.samples))
        const steps = Math.max(sampleCount - 1, 0)
        const x: number[] = []
        const y: number[] = []
        for (let i = 0; i < sampleCount; i += 1) {
          const t = steps === 0 ? min : min + ((max - min) * i) / steps
          x.push(t)
          y.push(t)
        }
        return { x, y }
      },
      opts
    )
    return await job.promise
  }

  async computeEventSeriesFromOrbit(
    request: ComputeEventSeriesFromOrbitRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<EventSeriesResult> {
    const job = this.queue.enqueue(
      'computeEventSeriesFromOrbit',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const samples: EventSeriesOrderedSample[] = []
        for (let index = 0; index <= request.steps; index += 1) {
          const time = request.startTime + index * request.dt
          const state = request.initialState.map((value, axis) => {
            const phase = time + axis * 0.7
            return value + Math.sin(phase)
          })
          samples.push({ time, state })
        }
        return buildMockEventSeries({
          system: request.system,
          samples,
          mode: request.mode,
          eventExpression: request.eventExpression,
          eventLevel: request.eventLevel,
          observableExpressions: request.observableExpressions,
        })
      },
      opts
    )
    return await job.promise
  }

  async computeEventSeriesFromSamples(
    request: ComputeEventSeriesFromSamplesRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<EventSeriesResult> {
    const job = this.queue.enqueue(
      'computeEventSeriesFromSamples',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        return buildMockEventSeries(request)
      },
      opts
    )
    return await job.promise
  }

  async computeIsocline(
    request: ComputeIsoclineRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<ComputeIsoclineResult> {
    const job = this.queue.enqueue(
      'computeIsocline',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const dim = request.system.varNames.length
        if (request.axes.length <= 1) {
          const point = request.frozenState.slice(0, dim)
          const axis = request.axes[0]
          if (axis) {
            const axisIndex = request.system.varNames.indexOf(axis.variableName)
            if (axisIndex >= 0) {
              point[axisIndex] = (axis.min + axis.max) * 0.5
            }
          }
          const result: ComputeIsoclineResult = {
            geometry: 'points',
            dim,
            points: point,
          }
          return result
        }
        if (request.axes.length === 2) {
          const axisA = request.axes[0]
          const axisB = request.axes[1]
          const idxA = request.system.varNames.indexOf(axisA.variableName)
          const idxB = request.system.varNames.indexOf(axisB.variableName)
          const p0 = request.frozenState.slice(0, dim)
          const p1 = request.frozenState.slice(0, dim)
          if (idxA >= 0) {
            p0[idxA] = axisA.min
            p1[idxA] = axisA.max
          }
          if (idxB >= 0) {
            p0[idxB] = axisB.min
            p1[idxB] = axisB.max
          }
          const result: ComputeIsoclineResult = {
            geometry: 'segments',
            dim,
            points: [...p0, ...p1],
            segments: [0, 1],
          }
          return result
        }
        const a = request.axes[0]
        const b = request.axes[1]
        const c = request.axes[2]
        const ia = request.system.varNames.indexOf(a.variableName)
        const ib = request.system.varNames.indexOf(b.variableName)
        const ic = request.system.varNames.indexOf(c.variableName)
        const p0 = request.frozenState.slice(0, dim)
        const p1 = request.frozenState.slice(0, dim)
        const p2 = request.frozenState.slice(0, dim)
        if (ia >= 0) {
          p0[ia] = a.min
          p1[ia] = a.max
          p2[ia] = a.min
        }
        if (ib >= 0) {
          p0[ib] = b.min
          p1[ib] = b.min
          p2[ib] = b.max
        }
        if (ic >= 0) {
          const mid = (c.min + c.max) * 0.5
          p0[ic] = mid
          p1[ic] = mid
          p2[ic] = mid
        }
        const result: ComputeIsoclineResult = {
          geometry: 'triangles',
          dim,
          points: [...p0, ...p1, ...p2],
          triangles: [0, 1, 2],
        }
        return result
      },
      opts
    )
    return await job.promise
  }

  async validateSystem(
    request: ValidateSystemRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<ValidateSystemResult> {
    const job = this.queue.enqueue(
      'validateSystem',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const equationErrors = request.system.equations.map((eq) =>
          eq.includes('INVALID') ? 'Mock parse error.' : null
        )
        const hasErrors = equationErrors.some((entry) => entry)
        return {
          ok: !hasErrors,
          equationErrors,
          message: hasErrors ? 'Mock parse error.' : undefined,
        }
      },
      opts
    )
    return await job.promise
  }

  async computeLyapunovExponents(
    request: LyapunovExponentsRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<number[]> {
    const job = this.queue.enqueue(
      'computeLyapunovExponents',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const dim = request.system.varNames.length
        return Array.from({ length: dim }, (_, index) => -0.05 * (index + 1))
      },
      opts
    )
    return await job.promise
  }

  async computeCovariantLyapunovVectors(
    request: CovariantLyapunovRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<CovariantLyapunovResponse> {
    const job = this.queue.enqueue(
      'computeCovariantLyapunovVectors',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const dimension = request.system.varNames.length
        const checkpoints = Math.max(1, Math.min(5, request.windowSteps))
        const times = Array.from({ length: checkpoints }, (_, index) =>
          request.startTime + request.dt * index
        )
        const vectors = Array.from({ length: dimension * dimension * checkpoints }, () => 0)
        for (let step = 0; step < checkpoints; step += 1) {
          for (let vec = 0; vec < dimension; vec += 1) {
            const base = step * dimension * dimension + vec * dimension + vec
            vectors[base] = 1
          }
        }
        return { dimension, checkpoints, times, vectors }
      },
      opts
    )
    return await job.promise
  }

  async solveEquilibrium(
    request: SolveEquilibriumRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SolveEquilibriumResult> {
    const job = this.queue.enqueue(
      'solveEquilibrium',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        return {
          state: request.initialGuess,
          residual_norm: 0,
          iterations: 1,
          jacobian: [],
          eigenpairs: [],
        }
      },
      opts
    )
    return await job.promise
  }

  async runEquilibriumContinuation(
    request: EquilibriumContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<EquilibriumContinuationResult> {
    const job = this.queue.enqueue(
      'runEquilibriumContinuation',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: request.system.params[0] ?? 0,
        }
        opts?.onProgress?.(progress)

        progress.done = true
        progress.current_step = request.settings.max_steps
        progress.points_computed = 3
        opts?.onProgress?.({ ...progress })

        return {
          points: [
            {
              state: request.equilibriumState,
              param_value: request.system.params[0] ?? 0,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0],
        }
      },
      opts
    )
    return await job.promise
  }

  async solveForcedPeriodicResponse(
    request: SolveForcedPeriodicResponseRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<SolveForcedPeriodicResponseResult> {
    const job = this.queue.enqueue(
      'solveForcedPeriodicResponse',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        const forcingPeriod =
          request.system.periodicForcing?.symbol === 'n'
            ? request.system.periodicForcing.iterationPeriod
            : 1
        return {
          state: [...request.initialGuess],
          residual_norm: 0,
          iterations: 1,
          monodromy: [],
          multipliers: [],
          cycle_points: [
            [...request.initialGuess],
            [...request.initialGuess],
          ],
          contexts: [request.phase * forcingPeriod, (request.phase + request.responseMultiple) * forcingPeriod],
          forcing_period: forcingPeriod,
          response_multiple: request.responseMultiple,
          minimal_response_multiple: 1,
        }
      },
      opts
    )
    return await job.promise
  }

  async runForcedPeriodicResponseContinuation(
    request: ForcedPeriodicResponseContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<ForcedPeriodicResponseContinuationResult> {
    const job = this.queue.enqueue(
      'runForcedPeriodicResponseContinuation',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        const paramIndex = request.system.paramNames.indexOf(request.parameterName)
        const paramValue = request.system.params[paramIndex] ?? 0
        const progress: ContinuationProgress = {
          done: true,
          current_step: request.settings.max_steps,
          max_steps: request.settings.max_steps,
          points_computed: 1,
          bifurcations_found: 0,
          current_param: paramValue,
        }
        opts?.onProgress?.(progress)
        const result: ForcedPeriodicResponseContinuationResult = {
          points: [
            {
              state: [...request.responseState],
              param_value: paramValue,
              stability: 'None',
              eigenvalues: [],
              cycle_points: [
                [...request.responseState],
                [...request.responseState],
              ],
            },
          ],
          bifurcations: [],
          indices: [0],
          branch_type: {
            type: 'ForcedPeriodicResponse',
            symbol: request.system.type === 'flow' ? 't' : 'n',
            period_expression:
              request.system.periodicForcing?.symbol === 't'
                ? request.system.periodicForcing.periodExpression
                : undefined,
            iteration_period:
              request.system.periodicForcing?.symbol === 'n'
                ? request.system.periodicForcing.iterationPeriod
                : undefined,
            phase: request.phase,
            response_multiple: request.responseMultiple,
            steps_per_forcing_period: request.stepsPerForcingPeriod,
            integrator: request.system.solver,
          },
        }
        return result
      },
      opts
    )
    return await job.promise
  }

  async runContinuationExtension(
    request: ContinuationExtensionRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<ContinuationExtensionResult> {
    const job = this.queue.enqueue(
      'runContinuationExtension',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: request.branchData.points.length,
          bifurcations_found: request.branchData.bifurcations.length,
          current_param: request.branchData.points[0]?.param_value ?? 0,
        }
        opts?.onProgress?.(progress)

        progress.done = true
        progress.current_step = request.settings.max_steps
        progress.points_computed = request.branchData.points.length
        opts?.onProgress?.({ ...progress })

        return normalizeBranchEigenvalues(request.branchData)
      },
      opts
    )
    return await job.promise
  }

  async runEquilibriumManifold1D(
    request: EquilibriumManifold1DRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<EquilibriumManifold1DResult> {
    const job = this.queue.enqueue(
      'runEquilibriumManifold1D',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const progress: ContinuationProgress = {
          done: true,
          current_step: 1,
          max_steps: 1,
          points_computed: 24,
          bifurcations_found: 0,
          current_param: request.settings.target_arclength,
        }
        opts?.onProgress?.(progress)

        const branches: EquilibriumManifold1DResult = []
        const isMap = request.system.type === 'map'
        const mapIterations =
          isMap && Number.isFinite(request.mapIterations)
            ? Math.max(1, Math.trunc(request.mapIterations as number))
            : 1
        const cyclePointIndices =
          isMap && mapIterations > 1 ? Array.from({ length: mapIterations }, (_, index) => index) : [0]
        const directions =
          request.settings.direction === 'Both'
            ? (['Plus', 'Minus'] as const)
            : ([request.settings.direction] as const)
        for (const cyclePointIndex of cyclePointIndices) {
          for (const direction of directions) {
            const sign = direction === 'Minus' ? -1 : 1
            const points: Array<{ state: number[]; param_value: number; stability: 'None'; eigenvalues: [] }> =
              []
            const pointsFlat: number[] = []
            const arclength: number[] = []
            const count = 24
            for (let i = 0; i < count; i += 1) {
              const t = i / (count - 1)
              const arc = t * request.settings.target_arclength
              const state = request.equilibriumState.map((value, index) =>
                index === 0
                  ? value + cyclePointIndex * 0.05 + sign * arc
                  : value + (isMap ? cyclePointIndex * 0.01 : 0)
              )
              points.push({ state, param_value: arc, stability: 'None', eigenvalues: [] })
              pointsFlat.push(...state)
              arclength.push(arc)
            }
            branches.push({
              points,
              bifurcations: [],
              indices: points.map((_, index) => index),
              branch_type: {
                type: 'ManifoldEq1D',
                stability: request.settings.stability,
                direction,
                eig_index: request.settings.eig_index ?? 0,
                method: isMap ? 'mock_map' : 'mock',
                caps: request.settings.caps,
                ...(isMap
                  ? {
                      map_iterations: mapIterations,
                      cycle_point_index: cyclePointIndex,
                    }
                  : {}),
              },
              manifold_geometry: {
                type: 'Curve',
                dim: request.system.varNames.length,
                points_flat: pointsFlat,
                arclength,
                direction,
              },
            })
          }
        }
        return branches
      },
      opts
    )
    return await job.promise
  }

  async runEquilibriumManifold1DExtension(
    request: EquilibriumManifold1DExtensionRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<EquilibriumManifold1DExtensionResult> {
    const job = this.queue.enqueue(
      'runEquilibriumManifold1DExtension',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        const branch = structuredClone(request.branchData)
        const endpoint = branch.points.at(-1)
        if (endpoint) {
          const next = {
            ...endpoint,
            state: endpoint.state.map((value, index) =>
              index === 0 ? value + request.settings.target_arclength : value
            ),
            param_value: endpoint.param_value + request.settings.target_arclength,
          }
          branch.points.push(next)
          branch.indices.push((branch.indices.at(-1) ?? -1) + 1)
        }
        opts?.onProgress?.({
          done: true,
          current_step: 1,
          max_steps: 1,
          points_computed: 1,
          bifurcations_found: 0,
          current_param: branch.points.at(-1)?.param_value ?? 0,
        })
        return normalizeBranchEigenvalues(branch)
      },
      opts
    )
    return await job.promise
  }

  async runManifold2DExtension(
    request: Manifold2DExtensionRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Manifold2DExtensionResult> {
    const job = this.queue.enqueue(
      'runManifold2DExtension',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        const branch = structuredClone(request.branchData)
        const endpoint = branch.points.at(-1)
        if (endpoint) {
          branch.points.push({
            ...endpoint,
            state: [...endpoint.state],
            param_value: endpoint.param_value + 1,
          })
          branch.indices.push((branch.indices.at(-1) ?? -1) + 1)
        }
        opts?.onProgress?.({
          done: true,
          current_step: 1,
          max_steps: 1,
          points_computed: endpoint ? 1 : 0,
          bifurcations_found: 0,
          current_param: branch.points.at(-1)?.param_value ?? 0,
          rings_computed: 1,
        })
        return normalizeBranchEigenvalues(branch)
      },
      opts
    )
    return await job.promise
  }

  async runEquilibriumManifold2D(
    request: EquilibriumManifold2DRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<EquilibriumManifold2DResult> {
    const job = this.queue.enqueue(
      'runEquilibriumManifold2D',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        opts?.onProgress?.({
          done: true,
          current_step: 1,
          max_steps: 1,
          points_computed: 64,
          bifurcations_found: 0,
          current_param: request.settings.target_radius,
        })
        const dim = request.system.varNames.length
        const ringPoints = Math.max(8, request.settings.ring_points)
        const rings = 4
        const vertices: number[][] = []
        const ringOffsets: number[] = []
        for (let r = 0; r < rings; r += 1) {
          ringOffsets.push(vertices.length)
          const radius = request.settings.initial_radius + r * request.settings.leaf_delta
          for (let i = 0; i < ringPoints; i += 1) {
            const theta = (2 * Math.PI * i) / ringPoints
            const state = request.equilibriumState.slice()
            state[0] = (state[0] ?? 0) + radius * Math.cos(theta)
            state[1] = (state[1] ?? 0) + radius * Math.sin(theta)
            if (dim > 2) state[2] = state[2] ?? 0
            vertices.push(state)
          }
        }
        const triangles: number[] = []
        for (let r = 0; r < rings - 1; r += 1) {
          const a0 = ringOffsets[r]
          const b0 = ringOffsets[r + 1]
          for (let i = 0; i < ringPoints; i += 1) {
            const ni = (i + 1) % ringPoints
            triangles.push(a0 + i, b0 + i, b0 + ni, a0 + i, b0 + ni, a0 + ni)
          }
        }
        const branch: EquilibriumManifold2DResult = {
          points: vertices.map((state, index) => ({
            state,
            param_value: index / ringPoints,
            stability: 'None',
            eigenvalues: [],
          })),
          bifurcations: [],
          indices: vertices.map((_, index) => index),
          branch_type: {
            type: 'ManifoldEq2D',
            stability: request.settings.stability,
            eig_kind: 'RealPair',
            eig_indices: request.settings.eig_indices ?? [0, 1],
            method: 'mock',
            caps: request.settings.caps,
          },
          manifold_geometry: {
            type: 'Surface',
            dim,
            vertices_flat: vertices.flat(),
            triangles,
            ring_offsets: ringOffsets,
            ring_diagnostics: ringOffsets.map((_, ring) => ({
              ring_index: ring,
              radius_estimate:
                request.settings.initial_radius + ring * request.settings.leaf_delta,
              point_count: ringPoints,
            })),
          },
        }
        return branch
      },
      opts
    )
    return await job.promise
  }

  async runLimitCycleManifold2D(
    request: LimitCycleManifold2DRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<LimitCycleManifold2DResult> {
    const job = this.queue.enqueue(
      'runLimitCycleManifold2D',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        opts?.onProgress?.({
          done: true,
          current_step: 1,
          max_steps: 1,
          points_computed: 64,
          bifurcations_found: 0,
          current_param: request.settings.target_arclength,
        })

        const dim = request.system.varNames.length
        const ringPoints = Math.max(8, request.settings.ring_points)
        const rings = 4
        const vertices: number[][] = []
        const ringOffsets: number[] = []
        for (let r = 0; r < rings; r += 1) {
          ringOffsets.push(vertices.length)
          const z = r * request.settings.leaf_delta
          for (let i = 0; i < ringPoints; i += 1) {
            const theta = (2 * Math.PI * i) / ringPoints
            const state = Array.from({ length: dim }, () => 0)
            state[0] = Math.cos(theta)
            state[1] = Math.sin(theta)
            if (dim > 2) state[2] = z
            vertices.push(state)
          }
        }
        const triangles: number[] = []
        for (let r = 0; r < rings - 1; r += 1) {
          const a0 = ringOffsets[r]
          const b0 = ringOffsets[r + 1]
          for (let i = 0; i < ringPoints; i += 1) {
            const ni = (i + 1) % ringPoints
            triangles.push(a0 + i, b0 + i, b0 + ni, a0 + i, b0 + ni, a0 + ni)
          }
        }
        const branch: LimitCycleManifold2DResult = {
          points: vertices.map((state, index) => ({
            state,
            param_value: index / ringPoints,
            stability: 'None',
            eigenvalues: [],
          })),
          bifurcations: [],
          indices: vertices.map((_, index) => index),
          branch_type: {
            type: 'ManifoldCycle2D',
            stability: request.settings.stability,
            direction: request.settings.direction ?? 'Plus',
            algorithm: request.settings.algorithm ?? 'GeodesicRings',
            floquet_index: 0,
            ntst: request.ntst,
            ncol: request.ncol,
            method:
              request.settings.algorithm === 'IsochronFibers'
                ? 'hko_fundamental_segment_bvp'
                : request.settings.algorithm === 'SegmentedPreimageFibers'
                  ? 'segmented_preimage_collocation'
                  : 'krauskopf_osinga_geodesic_leaf_continuation',
            caps: request.settings.caps,
          },
          manifold_geometry: {
            type: 'Surface',
            dim,
            vertices_flat: vertices.flat(),
            triangles,
            ring_offsets: ringOffsets,
            ring_diagnostics: ringOffsets.map((_, ring) => ({
              ring_index: ring,
              radius_estimate: ring * request.settings.leaf_delta,
              point_count: ringPoints,
            })),
          },
        }
        return branch
      },
      opts
    )
    return await job.promise
  }

  async computeLimitCycleFloquetModes(
    request: LimitCycleFloquetModesRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<LimitCycleFloquetModesResult> {
    const job = this.queue.enqueue(
      'computeLimitCycleFloquetModes',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        const dim = Math.max(1, request.system.varNames.length)
        const modeCount = dim
        const pointCount = Math.max(1, request.ntst * (request.ncol + 1) + 1)
        const multipliers = Array.from({ length: modeCount }, (_, index) => ({
          re: index === 0 ? 1 : Math.max(0.1, 0.85 - index * 0.1),
          im: index === 1 ? 0.2 : index === 2 ? -0.2 : 0,
        }))
        const vectors = Array.from({ length: pointCount }, (_, pointIndex) =>
          Array.from({ length: modeCount }, (_, modeIndex) =>
            Array.from({ length: dim }, (_, component) => {
              const angle = (2 * Math.PI * pointIndex) / Math.max(pointCount - 1, 1)
              if (modeIndex === component) {
                return { re: Math.cos(angle), im: Math.sin(angle) * 0.05 }
              }
              return { re: 0, im: 0 }
            })
          )
        )
        const backend: 'block_cyclic' | 'periodic_schur' =
          request.backend === 'block_cyclic' ? 'block_cyclic' : 'periodic_schur'
        return {
          ntst: request.ntst,
          ncol: request.ncol,
          backend,
          multipliers,
          vectors,
        }
      },
      opts
    )
    return await job.promise
  }

  async computeNormalForm(
    request: NormalFormComputationRequest,
    opts?: { signal?: AbortSignal }
  ): Promise<NormalFormComputationResult> {
    const job = this.queue.enqueue(
      'computeNormalForm',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        const basicConditioning = {
          eigenvector_pairing: 1,
          right_residual: 1e-10,
          left_residual: 1e-10,
          homological_residual: 1e-9,
        }
        if (request.sourceType === 'Map') {
          const normalForm = request.normalFormType === 'BranchPoint'
            ? {
                type: 'BranchPoint' as const,
                kind: 'Transcritical' as const,
                constant_parameter_coefficient: 0,
                linear_parameter_coefficient: 1,
                quadratic_coefficient: -1,
                cubic_coefficient: 0,
                conditioning: basicConditioning,
              }
            : request.normalFormType === 'PeriodDoubling'
              ? {
                  type: 'PeriodDoubling' as const,
                  parameter_coefficient: 1,
                  cubic_coefficient: -1,
                  criticality: 'Supercritical' as const,
                  conditioning: basicConditioning,
                }
              : {
                  type: 'NeimarkSacker' as const,
                  angle: Math.PI / 3,
                  multiplier: { re: 0.5, im: Math.sqrt(3) / 2 },
                  parameter_coefficient: { re: 1, im: 0 },
                  cubic_coefficient: { re: -1, im: 0 },
                  criticality: 'Supercritical' as const,
                  conditioning: basicConditioning,
                }
          return { normalForm }
        }
        if (request.sourceType === 'PeriodicOrbit') {
          const conditioning = {
            ...basicConditioning,
            return_map_residual: 1e-10,
            section_residual: 1e-10,
            return_time_correction: 1e-10,
            section_transversality: 1,
          }
          const normalForm = request.normalFormType === 'BranchPoint'
            ? {
                type: 'BranchPoint' as const,
                kind: 'Transcritical' as const,
                constant_parameter_coefficient: 0,
                linear_parameter_coefficient: 1,
                quadratic_coefficient: -1,
                cubic_coefficient: 0,
                critical_mode: request.state.slice(0, request.system.varNames.length).map((_, index) => index === 0 ? 1 : 0),
                conditioning,
              }
            : request.normalFormType === 'PeriodDoubling'
              ? {
                  type: 'PeriodDoubling' as const,
                  multiplier: -1,
                  parameter_coefficient: 1,
                  cubic_coefficient: -1,
                  criticality: 'Supercritical' as const,
                  critical_mode: request.state.slice(0, request.system.varNames.length).map((_, index) => index === 0 ? 1 : 0),
                  conditioning,
                }
              : {
                  type: 'NeimarkSacker' as const,
                  angle: Math.PI / 3,
                  multiplier: { re: 0.5, im: Math.sqrt(3) / 2 },
                  parameter_coefficient: { re: 1, im: 0 },
                  cubic_coefficient: { re: -1, im: 0 },
                  criticality: 'Supercritical' as const,
                  conditioning,
                }
          return { normalForm }
        }
        const diagnostics = {
          jacobian_condition_number: 2,
          unfolding_condition_number: 3,
          minimum_eigenvector_pairing: 0.9,
          max_eigen_residual: 1e-10,
          max_homological_residual: 1e-9,
          resonance_distance: 0.4,
        }
        if (request.sourceType === 'ZeroHopf') {
          return {
            normalForm: {
              type: 'ZeroHopf',
              state: [...request.state],
              param1_index: request.system.paramNames.indexOf(request.param1Name),
              param2_index: request.system.paramNames.indexOf(request.param2Name),
              param1_value: request.param1Value,
              param2_value: request.param2Value,
              frequency: request.sourceFrequency,
              zero_eigenvalue: 0,
              g200: 2,
              g011: -2,
              g110: { re: 1, im: 0 },
              g111: { re: 0, im: 0 },
              g021: { re: -1, im: 0 },
              f200: 2,
              f011: -2,
              f111: 0,
              reduced_g021: { re: -1, im: 0 },
              ns_center_coefficient: 1,
              ns_beta1: 1,
              ns_beta2: 0,
              has_neimark_sacker: true,
              diagnostics,
            } as NormalFormComputationResult['normalForm'],
          }
        }
        return {
          normalForm: {
            type: 'HopfHopf',
            state: [...request.state],
            param1_index: request.system.paramNames.indexOf(request.param1Name),
            param2_index: request.system.paramNames.indexOf(request.param2Name),
            param1_value: request.param1Value,
            param2_value: request.param2Value,
            frequency1: request.sourceFrequency,
            frequency2: request.sourceFrequency * 0.7,
            g2100: { re: -1, im: 0 },
            g0021: { re: -1, im: 0 },
            g1110: { re: -2, im: 0 },
            g1011: { re: -2, im: 0 },
            gamma: [
              [{ re: 1, im: 0 }, { re: 0, im: 0 }],
              [{ re: 0, im: 0 }, { re: 1, im: 0 }],
            ],
            neimark_sacker_predictors: [
              { periodic_mode: 1, parameter_quadratic: [-2, -3], frequency1_quadratic: 0, frequency2_quadratic: 0 },
              { periodic_mode: 2, parameter_quadratic: [-3, -2], frequency1_quadratic: 0, frequency2_quadratic: 0 },
            ],
            diagnostics,
          } as NormalFormComputationResult['normalForm'],
        }
      },
      opts
    )
    return await job.promise
  }

  async runPeriodicBranchPointSwitch(
    request: PeriodicBranchPointSwitchRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<PeriodicBranchPointSwitchResult> {
    const job = this.queue.enqueue(
      'runPeriodicBranchPointSwitch',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        const dim = request.system.varNames.length
        const normalForm: PeriodicBranchPointSwitchResult['normalForm'] = {
          type: 'BranchPoint',
          kind: 'Transcritical',
          constant_parameter_coefficient: 0,
          linear_parameter_coefficient: 1,
          quadratic_coefficient: -1,
          cubic_coefficient: 0,
          critical_mode: new Array(dim).fill(0).map((_, index) => index === 0 ? 1 : 0),
          conditioning: {
            eigenvector_pairing: 1,
            right_residual: 1e-10,
            left_residual: 1e-10,
            homological_residual: 1e-9,
            return_map_residual: 1e-10,
            section_residual: 1e-10,
            return_time_correction: 1e-10,
            section_transversality: 1,
          },
        }
        const meshPoints = request.normalizedMesh.length - 1
        const setup = {
          guess: {
            param_value: request.paramValue + request.amplitude,
            period: request.state[request.state.length - 1],
            mesh_states: Array.from({ length: meshPoints }, (_, index) =>
              request.state.slice(index * dim, (index + 1) * dim)
            ),
            stage_states: Array.from({ length: meshPoints }, () =>
              Array.from({ length: request.collocationDegree }, () => new Array(dim).fill(0))
            ),
            requires_fixed_parameter_correction: true,
          },
          phase_anchor: request.state.slice(0, dim),
          phase_direction: new Array(dim).fill(0).map((_, index) => index === 0 ? 1 : 0),
          mesh_points: meshPoints,
          collocation_degree: request.collocationDegree,
          normalized_mesh: [...request.normalizedMesh],
        }
        const branch = {
          points: [0, 1].map((index) => ({
            state: [...request.state],
            param_value: setup.guess.param_value + index * request.settings.step_size,
            stability: 'None' as const,
            eigenvalues: [],
          })),
          bifurcations: [],
          indices: [0, 1],
          branch_type: {
            type: 'LimitCycle' as const,
            ntst: meshPoints,
            ncol: request.collocationDegree,
            normalized_mesh: [...request.normalizedMesh],
          },
        }
        opts?.onProgress?.({
          done: true,
          current_step: 1,
          max_steps: request.settings.max_steps,
          points_computed: 2,
          bifurcations_found: 0,
          current_param: branch.points[1].param_value,
        })
        return { normalForm, setup, branch }
      },
      opts
    )
    return await job.promise
  }

  async runFoldCurveContinuation(
    request: FoldCurveContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim1CurveBranch> {
    const job = this.queue.enqueue(
      'runFoldCurveContinuation',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: request.param1Value,
        }
        opts?.onProgress?.(progress)

        progress.done = true
        progress.current_step = request.settings.max_steps
        progress.points_computed = 3
        opts?.onProgress?.({ ...progress })

        return {
          points: [
            {
              state: request.foldState,
              param1_value: request.param1Value,
              param2_value: request.param2Value,
              codim2_type: 'None',
              eigenvalues: [],
            },
          ],
          codim2_bifurcations: [],
          indices: [0],
        }
      },
      opts
    )
    return await job.promise
  }

  async runHopfCurveContinuation(
    request: HopfCurveContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim1CurveBranch> {
    const job = this.queue.enqueue(
      'runHopfCurveContinuation',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: request.param1Value,
        }
        opts?.onProgress?.(progress)

        progress.done = true
        progress.current_step = request.settings.max_steps
        progress.points_computed = 3
        opts?.onProgress?.({ ...progress })

        return {
          points: [
            {
              state: request.hopfState,
              param1_value: request.param1Value,
              param2_value: request.param2Value,
              codim2_type: 'None',
              eigenvalues: [],
              auxiliary: request.hopfOmega * request.hopfOmega,
            },
          ],
          codim2_bifurcations: [],
          indices: [0],
        }
      },
      opts
    )
    return await job.promise
  }

  async runCodim2BranchSwitch(
    request: Codim2BranchSwitchRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim2BranchSwitchResult> {
    const job = this.queue.enqueue(
      'runCodim2BranchSwitch',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        opts?.onProgress?.({
          done: true,
          current_step: request.settings.max_steps,
          max_steps: request.settings.max_steps,
          points_computed: 2,
          bifurcations_found: 0,
          current_param: request.param1Value,
        })
        const seed = {
          target: request.target,
          state: [...request.state],
          param1_value: request.param1Value + request.perturbation,
          param2_value: request.param2Value + request.perturbation,
          auxiliary: request.target === 'Hopf' ? request.perturbation : undefined,
          period: request.target === 'LimitPointCycle' ? Math.PI * 2 : undefined,
          ntst: request.ntst,
          ncol: request.ncol,
          perturbation: request.perturbation,
          predictor_residual: 1e-4,
          corrected_residual: 1e-9,
          correction_iterations: 2,
        }
        return {
          target: request.target,
          seed,
          branch: {
            points: [
              {
                state: [...request.state],
                param1_value: seed.param1_value,
                param2_value: seed.param2_value,
                codim2_type: 'None',
                eigenvalues: [],
                auxiliary: seed.auxiliary,
              },
              {
                state: [...request.state],
                param1_value: seed.param1_value + request.settings.step_size,
                param2_value: seed.param2_value,
                codim2_type: 'None',
                eigenvalues: [],
                auxiliary: seed.auxiliary,
              },
            ],
            codim2_bifurcations: [],
            indices: [0, 1],
          },
        }
      },
      opts
    )
    return await job.promise
  }

  async runIsoperiodicCurveContinuation(
    request: IsoperiodicCurveContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim1CurveBranch> {
    const job = this.queue.enqueue(
      'runIsoperiodicCurveContinuation',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: request.param1Value,
        }
        opts?.onProgress?.(progress)

        progress.done = true
        progress.current_step = request.settings.max_steps
        progress.points_computed = 3
        opts?.onProgress?.({ ...progress })

        return {
          points: [
            {
              state: [...request.lcState, request.period],
              param1_value: request.param1Value,
              param2_value: request.param2Value,
              codim2_type: 'None',
              eigenvalues: [],
            },
          ],
          codim2_bifurcations: [],
          indices: [0],
        }
      },
      opts
    )
    return await job.promise
  }

  async runLimitCycleCodim1CurveContinuation(
    request: LimitCycleCodim1CurveContinuationRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<Codim1CurveBranch> {
    const job = this.queue.enqueue(
      'runLimitCycleCodim1CurveContinuation',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        opts?.onProgress?.({
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: request.param1Value,
        })
        opts?.onProgress?.({
          done: true,
          current_step: 1,
          max_steps: request.settings.max_steps,
          points_computed: 2,
          bifurcations_found: 0,
          current_param: request.param1Value + request.settings.step_size,
        })

        const state = [...request.lcState, request.period]
        return {
          curve_type: request.curveType,
          points: [
            {
              state,
              param1_value: request.param1Value,
              param2_value: request.param2Value,
              codim2_type: 'None',
              eigenvalues: [],
              auxiliary:
                request.curveType === 'NeimarkSacker' ? request.initialK : undefined,
            },
            {
              state,
              param1_value: request.param1Value + request.settings.step_size,
              param2_value: request.param2Value + request.settings.step_size,
              codim2_type: 'None',
              eigenvalues: [],
              auxiliary:
                request.curveType === 'NeimarkSacker' ? request.initialK : undefined,
            },
          ],
          codim2_bifurcations: [],
          indices: [0, 1],
        }
      },
      opts
    )
    return await job.promise
  }

  async runLimitCycleContinuationFromHopf(
    request: LimitCycleContinuationFromHopfRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<LimitCycleContinuationResult> {
    const job = this.queue.enqueue(
      'runLimitCycleContinuationFromHopf',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: request.paramValue,
        }
        opts?.onProgress?.(progress)

        progress.done = true
        progress.current_step = request.settings.max_steps
        progress.points_computed = 2
        opts?.onProgress?.({ ...progress })

        const initialState = [...request.hopfState, 1]
        return normalizeBranchEigenvalues({
          points: [
            {
              state: initialState,
              param_value: request.paramValue,
              stability: 'None',
              eigenvalues: [],
            },
            {
              state: initialState,
              param_value: request.paramValue + request.settings.step_size,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0, 1],
          branch_type: { type: 'LimitCycle', ntst: request.ntst, ncol: request.ncol },
        })
      },
      opts
    )
    return await job.promise
  }

  async runLimitCycleContinuationFromOrbit(
    request: LimitCycleContinuationFromOrbitRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<LimitCycleContinuationResult> {
    const job = this.queue.enqueue(
      'runLimitCycleContinuationFromOrbit',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: request.paramValue,
        }
        opts?.onProgress?.(progress)

        progress.done = true
        progress.current_step = request.settings.max_steps
        progress.points_computed = 2
        opts?.onProgress?.({ ...progress })

        const initialState = new Array(request.system.varNames.length + 1).fill(0)
        return normalizeBranchEigenvalues({
          points: [
            {
              state: initialState,
              param_value: request.paramValue,
              stability: 'None',
              eigenvalues: [],
            },
            {
              state: initialState,
              param_value: request.paramValue + request.settings.step_size,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0, 1],
          branch_type: { type: 'LimitCycle', ntst: request.ntst, ncol: request.ncol },
        })
      },
      opts
    )
    return await job.promise
  }

  async runLimitCycleContinuationFromPD(
    request: LimitCycleContinuationFromPDRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<LimitCycleContinuationResult> {
    const job = this.queue.enqueue(
      'runLimitCycleContinuationFromPD',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: request.paramValue,
        }
        opts?.onProgress?.(progress)

        progress.done = true
        progress.current_step = request.settings.max_steps
        progress.points_computed = 2
        opts?.onProgress?.({ ...progress })

        const initialState =
          request.lcState.length > 0
            ? request.lcState
            : new Array(request.system.varNames.length + 1).fill(0)

        return normalizeBranchEigenvalues({
          points: [
            {
              state: initialState,
              param_value: request.paramValue,
              stability: 'None',
              eigenvalues: [],
            },
            {
              state: initialState,
              param_value: request.paramValue + request.settings.step_size,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0, 1],
          branch_type: {
            type: 'LimitCycle',
            ntst: request.ntst * 2,
            ncol: request.ncol,
          },
        })
      },
      opts
    )
    return await job.promise
  }

  async runHomoclinicFromLargeCycle(
    request: HomoclinicFromLargeCycleRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<HomoclinicContinuationResult> {
    const job = this.queue.enqueue(
      'runHomoclinicFromLargeCycle',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const paramIdx = request.system.paramNames.indexOf(request.parameterName)
        const paramValue = paramIdx >= 0 ? request.system.params[paramIdx] ?? 0 : 0
        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: paramValue,
        }
        opts?.onProgress?.(progress)
        opts?.onProgress?.({
          ...progress,
          done: true,
          current_step: request.settings.max_steps,
          points_computed: 2,
          current_param: paramValue + request.settings.step_size,
        })

        const shooting = request.discretization === 'shooting'
        const outputNtst = shooting
          ? request.shootingIntervals ?? DEFAULT_HOMOCLINIC_SHOOTING_INTERVALS
          : request.targetNtst
        const outputNcol = shooting ? 0 : request.targetNcol
        const state = (() => {
          if (!shooting) {
            return request.lcState.length > 0
              ? request.lcState
              : new Array(request.system.varNames.length + 1).fill(0)
          }
          const dim = Math.max(1, request.system.varNames.length)
          const firstNode = request.lcState.slice(0, dim)
          while (firstNode.length < dim) firstNode.push(0)
          const nodes = Array.from({ length: outputNtst + 1 }, () => firstNode).flat()
          const param2Index = request.system.paramNames.indexOf(request.param2Name)
          const param2Value =
            param2Index >= 0 ? request.system.params[param2Index] ?? 0 : 0
          const extras = [
            ...(request.freeTime ? [1] : []),
            ...(request.freeEps0 ? [0.01] : []),
            ...(request.freeEps1 ? [0.01] : []),
          ]
          return [...nodes, ...firstNode, param2Value, ...extras, 0, 0]
        })()
        return normalizeBranchEigenvalues({
          points: [
            { state, param_value: paramValue, stability: 'None', eigenvalues: [] },
            {
              state,
              param_value: paramValue + request.settings.step_size,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0, 1],
          branch_type: {
            type: 'HomoclinicCurve',
            ntst: outputNtst,
            ncol: outputNcol,
            param1_name: request.parameterName,
            param2_name: request.param2Name,
            free_time: request.freeTime,
            free_eps0: request.freeEps0,
            free_eps1: request.freeEps1,
            discretization: shooting
              ? {
                  type: 'shooting',
                  integration_steps_per_segment:
                    request.integrationStepsPerSegment ??
                    DEFAULT_HOMOCLINIC_INTEGRATION_STEPS_PER_SEGMENT,
                }
              : { type: 'collocation' },
          },
        })
      },
      opts
    )
    return await job.promise
  }

  async runHomoclinicFromHomoclinic(
    request: HomoclinicFromHomoclinicRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<HomoclinicContinuationResult> {
    const job = this.queue.enqueue(
      'runHomoclinicFromHomoclinic',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const paramIdx = request.system.paramNames.indexOf(request.parameterName)
        const paramValue = paramIdx >= 0 ? request.system.params[paramIdx] ?? 0 : 0
        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: paramValue,
        }
        opts?.onProgress?.(progress)
        opts?.onProgress?.({
          ...progress,
          done: true,
          current_step: request.settings.max_steps,
          points_computed: 2,
          current_param: paramValue + request.settings.step_size,
        })

        const state =
          request.pointState.length > 0
            ? request.pointState
            : new Array(request.system.varNames.length + 1).fill(0)
        return normalizeBranchEigenvalues({
          points: [
            { state, param_value: paramValue, stability: 'None', eigenvalues: [] },
            {
              state,
              param_value: paramValue + request.settings.step_size,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0, 1],
          branch_type: {
            type: 'HomoclinicCurve',
            ntst: request.targetNtst,
            ncol: request.targetNcol,
            param1_name: request.parameterName,
            param2_name: request.param2Name,
            free_time: request.freeTime,
            free_eps0: request.freeEps0,
            free_eps1: request.freeEps1,
          },
        })
      },
      opts
    )
    return await job.promise
  }

  async runHeteroclinicFromOrbit(
    request: HeteroclinicFromOrbitRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<HeteroclinicContinuationResult> {
    const job = this.queue.enqueue(
      'runHeteroclinicFromOrbit',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }
        const param1Index = request.system.paramNames.indexOf(request.parameterName)
        const param2Index = request.system.paramNames.indexOf(request.param2Name)
        const paramValue = request.system.params[param1Index] ?? 0
        const shooting = request.discretization === 'shooting'
        const outputNtst = shooting
          ? request.shootingIntervals ?? DEFAULT_HOMOCLINIC_SHOOTING_INTERVALS
          : request.ntst
        const outputNcol = shooting ? 0 : request.ncol
        opts?.onProgress?.({
          done: true,
          current_step: request.settings.max_steps,
          max_steps: request.settings.max_steps,
          points_computed: 2,
          bifurcations_found: 0,
          current_param: paramValue + request.settings.step_size,
        })
        const dim = request.system.varNames.length
        const zeroBasis = {
          stable_q: new Array(dim * dim).fill(0),
          unstable_q: new Array(dim * dim).fill(0),
          dim,
          nneg: Math.max(0, dim - 1),
          npos: dim > 0 ? 1 : 0,
        }
        const state = [
          ...request.orbitStates.flat(),
          ...request.sourceEquilibrium,
          ...request.targetEquilibrium,
        ]
        return normalizeBranchEigenvalues({
          points: [
            { state, param_value: paramValue, stability: 'None', eigenvalues: [] },
            {
              state,
              param_value: paramValue + request.settings.step_size,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0, 1],
          branch_type: {
            type: 'HeteroclinicCurve',
            schema: {
              schema_version: 1,
              base_params: [...request.system.params],
              param1_index: param1Index,
              param2_index: param2Index,
              source_basis: zeroBasis,
              target_basis: zeroBasis,
              fixed_time:
                (request.orbitTimes.at(-1) ?? 1) - (request.orbitTimes[0] ?? 0),
              fixed_eps0: 0.01,
              fixed_eps1: 0.01,
              projector_refresh_interval: request.projectorRefreshInterval ?? 2,
            },
            ntst: outputNtst,
            ncol: outputNcol,
            discretization: shooting
              ? {
                  type: 'shooting',
                  integration_steps_per_segment:
                    request.integrationStepsPerSegment ??
                    DEFAULT_HOMOCLINIC_INTEGRATION_STEPS_PER_SEGMENT,
                }
              : { type: 'collocation' },
            param1_name: request.parameterName,
            param2_name: request.param2Name,
            free_time: request.freeTime,
            free_eps0: request.freeEps0,
            free_eps1: request.freeEps1,
            normalized_mesh: Array.from(
              { length: request.ntst + 1 },
              (_, index) => index / request.ntst
            ),
            collocation_adaptivity: request.settings.collocation_adaptivity,
          },
        })
      },
      opts
    )
    return await job.promise
  }

  async runHomotopySaddleFromEquilibrium(
    request: HomotopySaddleFromEquilibriumRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<HomotopySaddleContinuationResult> {
    const job = this.queue.enqueue(
      'runHomotopySaddleFromEquilibrium',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const paramIdx = request.system.paramNames.indexOf(request.parameterName)
        const paramValue = paramIdx >= 0 ? request.system.params[paramIdx] ?? 0 : 0
        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: paramValue,
        }
        opts?.onProgress?.(progress)
        opts?.onProgress?.({
          ...progress,
          done: true,
          current_step: request.settings.max_steps,
          points_computed: 2,
          bifurcations_found: 1,
          current_param: paramValue + request.settings.step_size,
        })

        const state =
          request.equilibriumState.length > 0
            ? request.equilibriumState
            : new Array(request.system.varNames.length).fill(0)
        return normalizeBranchEigenvalues({
          points: [
            { state, param_value: paramValue, stability: 'None', eigenvalues: [] },
            {
              state,
              param_value: paramValue + request.settings.step_size,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [1],
          indices: [0, 1],
          branch_type: {
            type: 'HomotopySaddleCurve',
            ntst: request.ntst,
            ncol: request.ncol,
            param1_name: request.parameterName,
            param2_name: request.param2Name,
            stage: 'StageD',
          },
        })
      },
      opts
    )
    return await job.promise
  }

  async runHomoclinicFromHomotopySaddle(
    request: HomoclinicFromHomotopySaddleRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<HomoclinicContinuationResult> {
    const job = this.queue.enqueue(
      'runHomoclinicFromHomotopySaddle',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const paramIdx = request.system.paramNames.indexOf(request.parameterName)
        const paramValue = paramIdx >= 0 ? request.system.params[paramIdx] ?? 0 : 0
        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: paramValue,
        }
        opts?.onProgress?.(progress)
        opts?.onProgress?.({
          ...progress,
          done: true,
          current_step: request.settings.max_steps,
          points_computed: 2,
          current_param: paramValue + request.settings.step_size,
        })

        const state =
          request.stageDState.length > 0
            ? request.stageDState
            : new Array(request.system.varNames.length + 1).fill(0)
        return normalizeBranchEigenvalues({
          points: [
            { state, param_value: paramValue, stability: 'None', eigenvalues: [] },
            {
              state,
              param_value: paramValue + request.settings.step_size,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0, 1],
          branch_type: {
            type: 'HomoclinicCurve',
            ntst: request.targetNtst,
            ncol: request.targetNcol,
            param1_name: request.parameterName,
            param2_name: request.param2Name,
            free_time: request.freeTime,
            free_eps0: request.freeEps0,
            free_eps1: request.freeEps1,
          },
        })
      },
      opts
    )
    return await job.promise
  }

  async runMapCycleContinuationFromPD(
    request: MapCycleContinuationFromPDRequest,
    opts?: { signal?: AbortSignal; onProgress?: (progress: ContinuationProgress) => void }
  ): Promise<EquilibriumContinuationResult> {
    const job = this.queue.enqueue(
      'runMapCycleContinuationFromPD',
      async (signal) => {
        if (this.delayMs > 0) await delay(this.delayMs)
        if (signal.aborted) {
          const error = new Error('cancelled')
          error.name = 'AbortError'
          throw error
        }

        const progress: ContinuationProgress = {
          done: false,
          current_step: 0,
          max_steps: request.settings.max_steps,
          points_computed: 0,
          bifurcations_found: 0,
          current_param: request.paramValue,
        }
        opts?.onProgress?.(progress)

        progress.done = true
        progress.current_step = request.settings.max_steps
        progress.points_computed = 2
        opts?.onProgress?.({ ...progress })

        const initialState =
          request.pdState.length > 0
            ? request.pdState
            : new Array(request.system.varNames.length).fill(0)

        return normalizeBranchEigenvalues({
          points: [
            {
              state: initialState,
              param_value: request.paramValue,
              stability: 'None',
              eigenvalues: [],
            },
            {
              state: initialState,
              param_value: request.paramValue + request.settings.step_size,
              stability: 'None',
              eigenvalues: [],
            },
          ],
          bifurcations: [],
          indices: [0, 1],
          branch_type: { type: 'Equilibrium' },
        })
      },
      opts
    )
    return await job.promise
  }
}
