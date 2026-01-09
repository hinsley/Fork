/// <reference lib="webworker" />

import type {
  ContinuationProgress,
  EquilibriumContinuationRequest,
  EquilibriumContinuationResult,
  CovariantLyapunovRequest,
  CovariantLyapunovResponse,
  LyapunovExponentsRequest,
  SolveEquilibriumRequest,
  SolveEquilibriumResult,
  SimulateOrbitRequest,
  SimulateOrbitResult,
  ValidateSystemRequest,
  ValidateSystemResult,
} from '../ForkCoreClient'

type WorkerRequest =
  | { id: string; kind: 'simulateOrbit'; payload: SimulateOrbitRequest }
  | { id: string; kind: 'computeLyapunovExponents'; payload: LyapunovExponentsRequest }
  | { id: string; kind: 'computeCovariantLyapunovVectors'; payload: CovariantLyapunovRequest }
  | { id: string; kind: 'solveEquilibrium'; payload: SolveEquilibriumRequest }
  | { id: string; kind: 'runEquilibriumContinuation'; payload: EquilibriumContinuationRequest }
  | { id: string; kind: 'validateSystem'; payload: ValidateSystemRequest }
  | { id: string; kind: 'cancel' }

type WorkerProgress = { id: string; kind: 'progress'; progress: ContinuationProgress }

type WorkerResponse =
  | {
      id: string
      ok: true
      result:
        | SimulateOrbitResult
        | number[]
        | CovariantLyapunovResponse
        | SolveEquilibriumResult
        | ValidateSystemResult
        | EquilibriumContinuationResult
    }
  | { id: string; ok: false; error: string; aborted?: boolean }
  | WorkerProgress

type WasmModule = {
  WasmSystem: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    solver: string,
    systemType: string
  ) => {
    set_state: (state: Float64Array) => void
    get_state: () => Float64Array
    set_t: (t: number) => void
    get_t: () => number
    step: (dt: number) => void
    solve_equilibrium: (
      initialGuess: number[],
      maxSteps: number,
      dampingFactor: number
    ) => SolveEquilibriumResult
    compute_lyapunov_exponents: (
      startState: Float64Array,
      startTime: number,
      steps: number,
      dt: number,
      qrStride: number
    ) => Float64Array
    compute_covariant_lyapunov_vectors: (
      startState: Float64Array,
      startTime: number,
      windowSteps: number,
      dt: number,
      qrStride: number,
      forwardTransient: number,
      backwardTransient: number
    ) => CovariantLyapunovResponse
  }
  WasmEquilibriumRunner: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    systemType: string,
    equilibriumState: Float64Array,
    parameterName: string,
    settings: Record<string, number>,
    forward: boolean
  ) => {
    run_steps: (batchSize: number) => ContinuationProgress
    get_progress: () => ContinuationProgress
    get_result: () => EquilibriumContinuationResult
  }
  default?: (input?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module) => Promise<void>
}

const pendingControllers = new Map<string, AbortController>()

let wasmPromise: Promise<WasmModule> | null = null

async function loadWasm(): Promise<WasmModule> {
  if (!wasmPromise) {
    wasmPromise = import('@fork-wasm').then(async (mod) => {
      if (typeof mod.default === 'function') {
        await mod.default()
      }
      return mod as WasmModule
    })
  }
  return wasmPromise
}

async function runOrbit(request: SimulateOrbitRequest, signal: AbortSignal): Promise<SimulateOrbitResult> {
  const wasm = await loadWasm()
  const system = new wasm.WasmSystem(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.solver,
    request.system.type
  )

  system.set_t(0)
  system.set_state(new Float64Array(request.initialState))

  const data: number[][] = []
  let t = 0
  data.push([t, ...request.initialState])

  for (let i = 0; i < request.steps; i += 1) {
    if (signal.aborted) {
      const error = new Error('cancelled')
      error.name = 'AbortError'
      throw error
    }
    system.step(request.dt)
    t = system.get_t()
    const state = Array.from(system.get_state())
    data.push([t, ...state])
  }

  return {
    data,
    t_start: 0,
    t_end: t,
    dt: request.dt,
  }
}

async function runLyapunovExponents(
  request: LyapunovExponentsRequest,
  signal: AbortSignal
): Promise<number[]> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = new wasm.WasmSystem(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.solver,
    request.system.type
  )
  abortIfNeeded(signal)
  const result = system.compute_lyapunov_exponents(
    new Float64Array(request.startState),
    request.startTime,
    request.steps,
    request.dt,
    request.qrStride
  )
  return Array.from(result)
}

async function runCovariantLyapunovVectors(
  request: CovariantLyapunovRequest,
  signal: AbortSignal
): Promise<CovariantLyapunovResponse> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = new wasm.WasmSystem(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.solver,
    request.system.type
  )
  abortIfNeeded(signal)
  return system.compute_covariant_lyapunov_vectors(
    new Float64Array(request.startState),
    request.startTime,
    request.windowSteps,
    request.dt,
    request.qrStride,
    request.forwardTransient,
    request.backwardTransient
  )
}

async function runSolveEquilibrium(
  request: SolveEquilibriumRequest,
  signal: AbortSignal
): Promise<SolveEquilibriumResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = new wasm.WasmSystem(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.solver,
    request.system.type
  )
  abortIfNeeded(signal)
  return system.solve_equilibrium(
    request.initialGuess,
    request.maxSteps,
    request.dampingFactor
  )
}

const DEFAULT_PROGRESS_UPDATES = 50

function computeBatchSize(maxSteps: number): number {
  if (!Number.isFinite(maxSteps) || maxSteps <= 0) return 1
  return Math.max(1, Math.ceil(maxSteps / DEFAULT_PROGRESS_UPDATES))
}

async function runEquilibriumContinuation(
  request: EquilibriumContinuationRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<EquilibriumContinuationResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const settings: Record<string, number> = { ...request.settings }
  const runner = new wasm.WasmEquilibriumRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.type,
    new Float64Array(request.equilibriumState),
    request.parameterName,
    settings,
    request.forward
  )

  let progress = runner.get_progress()
  onProgress(progress)

  const batchSize = computeBatchSize(progress.max_steps)
  while (!progress.done) {
    abortIfNeeded(signal)
    progress = runner.run_steps(batchSize)
    onProgress(progress)
  }

  return runner.get_result()
}

function abortIfNeeded(signal: AbortSignal) {
  if (signal.aborted) {
    const error = new Error('cancelled')
    error.name = 'AbortError'
    throw error
  }
}

async function runValidateSystem(
  request: ValidateSystemRequest,
  signal: AbortSignal
): Promise<ValidateSystemResult> {
  const wasm = await loadWasm()
  const { system } = request
  const equationErrors = system.equations.map(() => null as string | null)

  try {
    abortIfNeeded(signal)
    // Attempt full system compile first for a fast pass.
    const instance = new wasm.WasmSystem(
      system.equations,
      new Float64Array(system.params),
      system.paramNames,
      system.varNames,
      system.solver,
      system.type
    )
    void instance
    return { ok: true, equationErrors }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    for (let i = 0; i < system.equations.length; i += 1) {
      abortIfNeeded(signal)
      try {
        const instance = new wasm.WasmSystem(
          [system.equations[i]],
          new Float64Array(system.params),
          system.paramNames,
          system.varNames,
          system.solver,
          system.type
        )
        void instance
      } catch (eqErr) {
        const eqMessage = eqErr instanceof Error ? eqErr.message : String(eqErr)
        equationErrors[i] = eqMessage
      }
    }
    const hasEquationErrors = equationErrors.some((entry) => entry)
    return {
      ok: false,
      equationErrors,
      message: hasEquationErrors ? undefined : message,
    }
  }
}

const ctx = self as DedicatedWorkerGlobalScope

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.kind === 'cancel') {
    const controller = pendingControllers.get(message.id)
    if (controller) {
      controller.abort()
      pendingControllers.delete(message.id)
    }
    return
  }

  const controller = new AbortController()
  pendingControllers.set(message.id, controller)

  try {
    if (message.kind === 'simulateOrbit') {
      const result = await runOrbit(message.payload, controller.signal)
      const response: WorkerResponse = { id: message.id, ok: true, result }
      ctx.postMessage(response)
      return
    }

    if (message.kind === 'computeLyapunovExponents') {
      const result = await runLyapunovExponents(message.payload, controller.signal)
      const response: WorkerResponse = { id: message.id, ok: true, result }
      ctx.postMessage(response)
      return
    }

    if (message.kind === 'computeCovariantLyapunovVectors') {
      const result = await runCovariantLyapunovVectors(message.payload, controller.signal)
      const response: WorkerResponse = { id: message.id, ok: true, result }
      ctx.postMessage(response)
      return
    }

    if (message.kind === 'solveEquilibrium') {
      const result = await runSolveEquilibrium(message.payload, controller.signal)
      const response: WorkerResponse = { id: message.id, ok: true, result }
      ctx.postMessage(response)
      return
    }

    if (message.kind === 'runEquilibriumContinuation') {
      const result = await runEquilibriumContinuation(
        message.payload,
        controller.signal,
        (progress) => {
          const response: WorkerResponse = {
            id: message.id,
            kind: 'progress',
            progress,
          }
          ctx.postMessage(response)
        }
      )
      const response: WorkerResponse = { id: message.id, ok: true, result }
      ctx.postMessage(response)
      return
    }

    if (message.kind === 'validateSystem') {
      const result = await runValidateSystem(message.payload, controller.signal)
      const response: WorkerResponse = { id: message.id, ok: true, result }
      ctx.postMessage(response)
      return
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    const response: WorkerResponse = {
      id: message.id,
      ok: false,
      error: error.message,
      aborted: error.name === 'AbortError',
    }
    ctx.postMessage(response)
  } finally {
    pendingControllers.delete(message.id)
  }
}
