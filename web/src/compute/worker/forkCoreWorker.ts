/// <reference lib="webworker" />

import type {
  Codim1CurveBranch,
  ContinuationProgress,
  ContinuationExtensionRequest,
  ContinuationExtensionResult,
  EquilibriumContinuationRequest,
  EquilibriumContinuationResult,
  LimitCycleContinuationFromHopfRequest,
  LimitCycleContinuationFromOrbitRequest,
  LimitCycleContinuationFromPDRequest,
  LimitCycleContinuationResult,
  MapCycleContinuationFromPDRequest,
  CovariantLyapunovRequest,
  CovariantLyapunovResponse,
  FoldCurveContinuationRequest,
  HopfCurveContinuationRequest,
  LyapunovExponentsRequest,
  SampleMap1DFunctionRequest,
  SampleMap1DFunctionResult,
  SolveEquilibriumRequest,
  SolveEquilibriumResult,
  SimulateOrbitRequest,
  SimulateOrbitResult,
  ValidateSystemRequest,
  ValidateSystemResult,
} from '../ForkCoreClient'

type WorkerRequest =
  | { id: string; kind: 'simulateOrbit'; payload: SimulateOrbitRequest }
  | { id: string; kind: 'sampleMap1DFunction'; payload: SampleMap1DFunctionRequest }
  | { id: string; kind: 'computeLyapunovExponents'; payload: LyapunovExponentsRequest }
  | { id: string; kind: 'computeCovariantLyapunovVectors'; payload: CovariantLyapunovRequest }
  | { id: string; kind: 'solveEquilibrium'; payload: SolveEquilibriumRequest }
  | { id: string; kind: 'runEquilibriumContinuation'; payload: EquilibriumContinuationRequest }
  | { id: string; kind: 'runContinuationExtension'; payload: ContinuationExtensionRequest }
  | { id: string; kind: 'runFoldCurveContinuation'; payload: FoldCurveContinuationRequest }
  | { id: string; kind: 'runHopfCurveContinuation'; payload: HopfCurveContinuationRequest }
  | {
      id: string
      kind: 'runLimitCycleContinuationFromHopf'
      payload: LimitCycleContinuationFromHopfRequest
    }
  | {
      id: string
      kind: 'runLimitCycleContinuationFromOrbit'
      payload: LimitCycleContinuationFromOrbitRequest
    }
  | {
      id: string
      kind: 'runLimitCycleContinuationFromPD'
      payload: LimitCycleContinuationFromPDRequest
    }
  | {
      id: string
      kind: 'runMapCycleContinuationFromPD'
      payload: MapCycleContinuationFromPDRequest
    }
  | { id: string; kind: 'validateSystem'; payload: ValidateSystemRequest }
  | { id: string; kind: 'cancel' }

type WorkerProgress = { id: string; kind: 'progress'; progress: ContinuationProgress }

type WorkerResponse =
  | {
      id: string
      ok: true
      result:
        | SimulateOrbitResult
        | SampleMap1DFunctionResult
        | number[]
        | CovariantLyapunovResponse
        | SolveEquilibriumResult
        | ValidateSystemResult
        | EquilibriumContinuationResult
        | ContinuationExtensionResult
        | Codim1CurveBranch
        | LimitCycleContinuationResult
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
      dampingFactor: number,
      mapIterations: number
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
    init_lc_from_hopf: (
      hopfState: Float64Array,
      parameterName: string,
      paramValue: number,
      amplitude: number,
      ntst: number,
      ncol: number
    ) => unknown
    init_lc_from_orbit: (
      orbitTimes: Float64Array,
      orbitStates: Float64Array,
      paramValue: number,
      ntst: number,
      ncol: number,
      tolerance: number
    ) => unknown
    init_lc_from_pd: (
      lcState: Float64Array,
      parameterName: string,
      paramValue: number,
      ntst: number,
      ncol: number,
      amplitude: number
    ) => unknown
    init_map_cycle_from_pd: (
      pdState: number[],
      parameterName: string,
      paramValue: number,
      mapIterations: number,
      amplitude: number
    ) => unknown
  }
  WasmEquilibriumRunner: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    systemType: string,
    mapIterations: number,
    equilibriumState: Float64Array,
    parameterName: string,
    settings: Record<string, number>,
    forward: boolean
  ) => {
    run_steps: (batchSize: number) => ContinuationProgress
    get_progress: () => ContinuationProgress
    get_result: () => EquilibriumContinuationResult
  }
  WasmFoldCurveRunner: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    systemType: string,
    mapIterations: number,
    foldState: Float64Array,
    param1Name: string,
    param1Value: number,
    param2Name: string,
    param2Value: number,
    settings: Record<string, number>,
    forward: boolean
  ) => {
    run_steps: (batchSize: number) => ContinuationProgress
    get_progress: () => ContinuationProgress
    get_result: () => Codim1CurveBranch
  }
  WasmHopfCurveRunner: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    systemType: string,
    mapIterations: number,
    hopfState: Float64Array,
    hopfOmega: number,
    param1Name: string,
    param1Value: number,
    param2Name: string,
    param2Value: number,
    settings: Record<string, number>,
    forward: boolean
  ) => {
    run_steps: (batchSize: number) => ContinuationProgress
    get_progress: () => ContinuationProgress
    get_result: () => Codim1CurveBranch
  }
  WasmLimitCycleRunner: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    systemType: string,
    setup: unknown,
    parameterName: string,
    settings: Record<string, number>,
    forward: boolean
  ) => {
    run_steps: (batchSize: number) => ContinuationProgress
    get_progress: () => ContinuationProgress
    get_result: () => LimitCycleContinuationResult
  }
  WasmContinuationExtensionRunner: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    systemType: string,
    mapIterations: number,
    branchData: ContinuationExtensionRequest['branchData'],
    parameterName: string,
    settings: Record<string, number>,
    forward: boolean
  ) => {
    run_steps: (batchSize: number) => ContinuationProgress
    get_progress: () => ContinuationProgress
    get_result: () => ContinuationExtensionResult
  }
  WasmCodim1CurveExtensionRunner: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    systemType: string,
    mapIterations: number,
    branchData: ContinuationExtensionRequest['branchData'],
    parameterName: string,
    settings: Record<string, number>,
    forward: boolean
  ) => {
    run_steps: (batchSize: number) => ContinuationProgress
    get_progress: () => ContinuationProgress
    get_result: () => ContinuationExtensionResult
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

async function runSampleMap1DFunction(
  request: SampleMap1DFunctionRequest,
  signal: AbortSignal
): Promise<SampleMap1DFunctionResult> {
  const wasm = await loadWasm()
  const { system: config } = request
  if (config.type !== 'map' || config.varNames.length !== 1) {
    return { x: [], y: [] }
  }

  const min = Math.min(request.min, request.max)
  const max = Math.max(request.min, request.max)
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { x: [], y: [] }
  }

  const sampleCount = Math.max(1, Math.floor(request.samples))
  const steps = Math.max(sampleCount - 1, 0)
  const xValues: number[] = []
  const yValues: number[] = []

  const system = new wasm.WasmSystem(
    config.equations,
    new Float64Array(config.params),
    config.paramNames,
    config.varNames,
    config.solver,
    config.type
  )

  for (let i = 0; i < sampleCount; i += 1) {
    abortIfNeeded(signal)
    const t = steps === 0 ? min : min + ((max - min) * i) / steps
    system.set_t(0)
    system.set_state(new Float64Array([t]))
    system.step(1)
    const next = system.get_state()[0]
    if (!Number.isFinite(next)) continue
    xValues.push(t)
    yValues.push(next)
  }

  return { x: xValues, y: yValues }
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
  const mapIterations =
    request.system.type === 'map' ? request.mapIterations ?? 1 : 1
  return system.solve_equilibrium(
    request.initialGuess,
    request.maxSteps,
    request.dampingFactor,
    mapIterations
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
  const mapIterations =
    request.system.type === 'map' ? request.mapIterations ?? 1 : 1
  const runner = new wasm.WasmEquilibriumRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.type,
    mapIterations,
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

function isCodim1BranchType(branchType: unknown): boolean {
  if (!branchType || typeof branchType !== 'object') {
    return false
  }
  const type = (branchType as { type?: string }).type
  return (
    type === 'FoldCurve' ||
    type === 'HopfCurve' ||
    type === 'LPCCurve' ||
    type === 'PDCurve' ||
    type === 'NSCurve'
  )
}

async function runContinuationExtension(
  request: ContinuationExtensionRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<ContinuationExtensionResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const settings: Record<string, number> = { ...request.settings }
  const mapIterations =
    request.system.type === 'map' ? request.mapIterations ?? 1 : 1
  const runner = isCodim1BranchType(request.branchData.branch_type)
    ? new wasm.WasmCodim1CurveExtensionRunner(
        request.system.equations,
        new Float64Array(request.system.params),
        request.system.paramNames,
        request.system.varNames,
        request.system.type,
        mapIterations,
        request.branchData,
        request.parameterName,
        settings,
        request.forward
      )
    : new wasm.WasmContinuationExtensionRunner(
        request.system.equations,
        new Float64Array(request.system.params),
        request.system.paramNames,
        request.system.varNames,
        request.system.type,
        mapIterations,
        request.branchData,
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

async function runFoldCurveContinuation(
  request: FoldCurveContinuationRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<Codim1CurveBranch> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const settings: Record<string, number> = { ...request.settings }
  const mapIterations =
    request.system.type === 'map' ? request.mapIterations ?? 1 : 1
  const runner = new wasm.WasmFoldCurveRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.type,
    mapIterations,
    new Float64Array(request.foldState),
    request.param1Name,
    request.param1Value,
    request.param2Name,
    request.param2Value,
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

async function runHopfCurveContinuation(
  request: HopfCurveContinuationRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<Codim1CurveBranch> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const settings: Record<string, number> = { ...request.settings }
  const mapIterations =
    request.system.type === 'map' ? request.mapIterations ?? 1 : 1
  const runner = new wasm.WasmHopfCurveRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.type,
    mapIterations,
    new Float64Array(request.hopfState),
    request.hopfOmega,
    request.param1Name,
    request.param1Value,
    request.param2Name,
    request.param2Value,
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

async function runLimitCycleContinuationFromHopf(
  request: LimitCycleContinuationFromHopfRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<LimitCycleContinuationResult> {
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

  const setup = system.init_lc_from_hopf(
    new Float64Array(request.hopfState),
    request.parameterName,
    request.paramValue,
    request.amplitude,
    request.ntst,
    request.ncol
  )

  const settings: Record<string, number> = { ...request.settings }
  const runner = new wasm.WasmLimitCycleRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.type,
    setup,
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

async function runLimitCycleContinuationFromOrbit(
  request: LimitCycleContinuationFromOrbitRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<LimitCycleContinuationResult> {
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

  const orbitTimes = new Float64Array(request.orbitTimes)
  const orbitStates = new Float64Array(request.orbitStates.flat())
  const setup = system.init_lc_from_orbit(
    orbitTimes,
    orbitStates,
    request.paramValue,
    request.ntst,
    request.ncol,
    request.tolerance
  )

  const settings: Record<string, number> = { ...request.settings }
  const runner = new wasm.WasmLimitCycleRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.type,
    setup,
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

async function runLimitCycleContinuationFromPD(
  request: LimitCycleContinuationFromPDRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<LimitCycleContinuationResult> {
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

  const setup = system.init_lc_from_pd(
    new Float64Array(request.lcState),
    request.parameterName,
    request.paramValue,
    request.ntst,
    request.ncol,
    request.amplitude
  )

  const settings: Record<string, number> = { ...request.settings }
  const runner = new wasm.WasmLimitCycleRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.type,
    setup,
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

async function runMapCycleContinuationFromPD(
  request: MapCycleContinuationFromPDRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<EquilibriumContinuationResult> {
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

  let seed = system.init_map_cycle_from_pd(
    request.pdState,
    request.parameterName,
    request.paramValue,
    request.mapIterations,
    request.amplitude
  ) as number[]

  let nextIterations = Math.max(1, Math.trunc(request.mapIterations * 2))
  if (request.solverParams) {
    const solverIterations =
      request.solverParams.mapIterations ?? nextIterations
    const mapIterations = Math.max(1, Math.trunc(solverIterations))
    const solution = system.solve_equilibrium(
      seed,
      request.solverParams.maxSteps,
      request.solverParams.dampingFactor,
      mapIterations
    )
    if (!solution.state || solution.state.length === 0) {
      throw new Error('Cycle solve did not return a valid state.')
    }
    seed = solution.state
    nextIterations = mapIterations
  }
  return runEquilibriumContinuation(
    {
      system: request.system,
      equilibriumState: seed,
      parameterName: request.parameterName,
      mapIterations: nextIterations,
      settings: request.settings,
      forward: request.forward,
    },
    signal,
    onProgress
  )
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

    if (message.kind === 'sampleMap1DFunction') {
      const result = await runSampleMap1DFunction(message.payload, controller.signal)
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

    if (message.kind === 'runContinuationExtension') {
      const result = await runContinuationExtension(
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

    if (message.kind === 'runFoldCurveContinuation') {
      const result = await runFoldCurveContinuation(
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

    if (message.kind === 'runHopfCurveContinuation') {
      const result = await runHopfCurveContinuation(
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

    if (message.kind === 'runLimitCycleContinuationFromHopf') {
      const result = await runLimitCycleContinuationFromHopf(
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

    if (message.kind === 'runLimitCycleContinuationFromOrbit') {
      const result = await runLimitCycleContinuationFromOrbit(
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

    if (message.kind === 'runLimitCycleContinuationFromPD') {
      const result = await runLimitCycleContinuationFromPD(
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

    if (message.kind === 'runMapCycleContinuationFromPD') {
      const result = await runMapCycleContinuationFromPD(
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
