import type {
  ComputeIsoclineRequest,
  ComputeIsoclineResult,
  Codim1CurveBranch,
  ContinuationProgress,
  ContinuationExtensionRequest,
  ContinuationExtensionResult,
  CovariantLyapunovRequest,
  CovariantLyapunovResponse,
  EquilibriumContinuationRequest,
  EquilibriumContinuationResult,
  FoldCurveContinuationRequest,
  ForkCoreClient,
  HopfCurveContinuationRequest,
  LimitCycleContinuationFromHopfRequest,
  LimitCycleContinuationFromOrbitRequest,
  LimitCycleContinuationFromPDRequest,
  LimitCycleContinuationResult,
  MapCycleContinuationFromPDRequest,
  LyapunovExponentsRequest,
  SampleMap1DFunctionRequest,
  SampleMap1DFunctionResult,
  SolveEquilibriumRequest,
  SolveEquilibriumResult,
  SimulateOrbitRequest,
  SimulateOrbitResult,
  ValidateSystemRequest,
  ValidateSystemResult,
} from './ForkCoreClient'
import { JobQueue } from './jobQueue'
import { normalizeBranchEigenvalues } from '../system/continuation'
import { isDeterministicMode } from '../utils/determinism'

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
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
        let t = 0
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
          t_start: 0,
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
