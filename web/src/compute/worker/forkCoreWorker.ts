/// <reference lib="webworker" />

import type {
  ComputeEventSeriesFromOrbitRequest,
  ComputeEventSeriesFromSamplesRequest,
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
  EquilibriumManifold1DRequest,
  EquilibriumManifold1DResult,
  EquilibriumManifold2DRequest,
  EquilibriumManifold2DResult,
  EventSeriesResult,
  FoldCurveContinuationRequest,
  HomoclinicContinuationResult,
  HomoclinicFromHomoclinicRequest,
  HomoclinicFromHomotopySaddleRequest,
  HomoclinicFromLargeCycleRequest,
  HomotopySaddleContinuationResult,
  HomotopySaddleFromEquilibriumRequest,
  HopfCurveContinuationRequest,
  IsochroneCurveContinuationRequest,
  LimitCycleContinuationFromHopfRequest,
  LimitCycleContinuationFromOrbitRequest,
  LimitCycleContinuationFromPDRequest,
  LimitCycleContinuationResult,
  LimitCycleFloquetModesRequest,
  LimitCycleFloquetModesResult,
  LimitCycleManifold2DRequest,
  LimitCycleManifold2DResult,
  LyapunovExponentsRequest,
  MapCycleContinuationFromPDRequest,
  PowerSpectrumCsvFileRequest,
  PowerSpectrumOrbitRequest,
  PowerSpectrumResult,
  PowerSpectrumSamplesRequest,
  SampleMap1DFunctionRequest,
  SampleMap1DFunctionResult,
  SimulateOrbitRequest,
  SimulateOrbitResult,
  SolveEquilibriumRequest,
  SolveEquilibriumResult,
  ValidateSystemRequest,
  ValidateSystemResult,
} from '../ForkCoreClient'
import { discardHomoclinicInitialApproximationPoint } from '../../system/continuation'

const MAX_DATASET_PREVIEW_ROWS = 4096

type WorkerRequest =
  | { id: string; kind: 'simulateOrbit'; payload: SimulateOrbitRequest }
  | { id: string; kind: 'sampleMap1DFunction'; payload: SampleMap1DFunctionRequest }
  | { id: string; kind: 'computeEventSeriesFromOrbit'; payload: ComputeEventSeriesFromOrbitRequest }
  | {
      id: string
      kind: 'computeEventSeriesFromSamples'
      payload: ComputeEventSeriesFromSamplesRequest
    }
  | { id: string; kind: 'computeIsocline'; payload: ComputeIsoclineRequest }
  | { id: string; kind: 'computeLyapunovExponents'; payload: LyapunovExponentsRequest }
  | { id: string; kind: 'computeCovariantLyapunovVectors'; payload: CovariantLyapunovRequest }
  | { id: string; kind: 'computePowerSpectrumFromSamples'; payload: PowerSpectrumSamplesRequest }
  | { id: string; kind: 'computePowerSpectrumFromOrbit'; payload: PowerSpectrumOrbitRequest }
  | { id: string; kind: 'computePowerSpectrumFromCsvFile'; payload: PowerSpectrumCsvFileRequest }
  | { id: string; kind: 'solveEquilibrium'; payload: SolveEquilibriumRequest }
  | { id: string; kind: 'runEquilibriumContinuation'; payload: EquilibriumContinuationRequest }
  | { id: string; kind: 'runContinuationExtension'; payload: ContinuationExtensionRequest }
  | { id: string; kind: 'runEquilibriumManifold1D'; payload: EquilibriumManifold1DRequest }
  | { id: string; kind: 'runEquilibriumManifold2D'; payload: EquilibriumManifold2DRequest }
  | { id: string; kind: 'runLimitCycleManifold2D'; payload: LimitCycleManifold2DRequest }
  | { id: string; kind: 'computeLimitCycleFloquetModes'; payload: LimitCycleFloquetModesRequest }
  | { id: string; kind: 'runFoldCurveContinuation'; payload: FoldCurveContinuationRequest }
  | { id: string; kind: 'runHopfCurveContinuation'; payload: HopfCurveContinuationRequest }
  | {
      id: string
      kind: 'runIsochroneCurveContinuation'
      payload: IsochroneCurveContinuationRequest
    }
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
  | {
      id: string
      kind: 'runHomoclinicFromLargeCycle'
      payload: HomoclinicFromLargeCycleRequest
    }
  | {
      id: string
      kind: 'runHomoclinicFromHomoclinic'
      payload: HomoclinicFromHomoclinicRequest
    }
  | {
      id: string
      kind: 'runHomotopySaddleFromEquilibrium'
      payload: HomotopySaddleFromEquilibriumRequest
    }
  | {
      id: string
      kind: 'runHomoclinicFromHomotopySaddle'
      payload: HomoclinicFromHomotopySaddleRequest
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
        | EventSeriesResult
        | ComputeIsoclineResult
        | number[]
        | CovariantLyapunovResponse
        | PowerSpectrumResult
        | SolveEquilibriumResult
        | ValidateSystemResult
        | EquilibriumContinuationResult
        | ContinuationExtensionResult
        | EquilibriumManifold1DResult
        | EquilibriumManifold2DResult
        | LimitCycleManifold2DResult
        | LimitCycleFloquetModesResult
        | Codim1CurveBranch
        | LimitCycleContinuationResult
        | HomoclinicContinuationResult
        | HomotopySaddleContinuationResult
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
    compute_event_series_from_orbit?: (request: Record<string, unknown>) => EventSeriesResult
    computeEventSeriesFromOrbit?: (request: Record<string, unknown>) => EventSeriesResult
    compute_event_series_from_samples?: (request: Record<string, unknown>) => EventSeriesResult
    computeEventSeriesFromSamples?: (request: Record<string, unknown>) => EventSeriesResult
    compute_isocline?: (
      expression: string,
      level: number,
      axisIndices: number[],
      axisMins: number[],
      axisMaxs: number[],
      axisSamples: number[],
      frozenState: number[],
      varNames: string[],
      paramNames: string[]
    ) => ComputeIsoclineResult
    computeIsocline?: (
      expression: string,
      level: number,
      axisIndices: number[],
      axisMins: number[],
      axisMaxs: number[],
      axisSamples: number[],
      frozenState: number[],
      varNames: string[],
      paramNames: string[]
    ) => ComputeIsoclineResult
    solve_equilibrium: (
      initialGuess: number[],
      maxSteps: number,
      dampingFactor: number,
      mapIterations: number
    ) => SolveEquilibriumResult
    compute_eq_manifold_2d_with_progress?: (
      equilibriumState: Float64Array,
      settings: Record<string, unknown>,
      onProgress: (progress: ContinuationProgress) => void
    ) => EquilibriumManifold2DResult
    compute_cycle_manifold_2d_with_progress?: (
      cycleState: Float64Array,
      ntst: number,
      ncol: number,
      floquetMultipliers: Array<{ re: number; im: number }>,
      settings: Record<string, unknown>,
      onProgress: (progress: ContinuationProgress) => void
    ) => LimitCycleManifold2DResult
    compute_limit_cycle_floquet_modes?: (
      cycleState: Float64Array,
      ntst: number,
      ncol: number,
      parameterName: string
    ) => LimitCycleFloquetModesResult
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
    init_homoclinic_from_large_cycle: (
      lcState: Float64Array,
      sourceNtst: number,
      sourceNcol: number,
      parameterName: string,
      param2Name: string,
      targetNtst: number,
      targetNcol: number,
      freeTime: boolean,
      freeEps0: boolean,
      freeEps1: boolean
    ) => unknown
    init_homoclinic_from_homoclinic: (
      pointState: Float64Array,
      sourceNtst: number,
      sourceNcol: number,
      sourceFreeTime: boolean,
      sourceFreeEps0: boolean,
      sourceFreeEps1: boolean,
      sourceFixedTime: number,
      sourceFixedEps0: number,
      sourceFixedEps1: number,
      parameterName: string,
      param2Name: string,
      targetNtst: number,
      targetNcol: number,
      freeTime: boolean,
      freeEps0: boolean,
      freeEps1: boolean
    ) => unknown
    init_homotopy_saddle_from_equilibrium: (
      equilibriumState: Float64Array,
      parameterName: string,
      param2Name: string,
      ntst: number,
      ncol: number,
      eps0: number,
      eps1: number,
      time: number,
      eps1Tol: number
    ) => unknown
    init_homoclinic_from_homotopy_saddle: (
      stageDState: Float64Array,
      sourceNtst: number,
      sourceNcol: number,
      parameterName: string,
      param2Name: string,
      targetNtst: number,
      targetNcol: number,
      freeTime: boolean,
      freeEps0: boolean,
      freeEps1: boolean
    ) => unknown
    init_map_cycle_from_pd: (
      pdState: number[],
      parameterName: string,
      paramValue: number,
      mapIterations: number,
      amplitude: number
    ) => unknown
  }
  WasmPowerSpectrumAccumulator: new (
    sampleInterval: number,
    windowSize: number
  ) => {
    push_samples: (samples: number[]) => void
    finish: () => PowerSpectrumResult
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
  WasmEqManifold1DRunner: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    systemType: string,
    mapIterations: number,
    equilibriumState: Float64Array,
    settings: Record<string, unknown>
  ) => {
    run_steps: (batchSize: number) => ContinuationProgress
    get_progress: () => ContinuationProgress
    get_result: () => EquilibriumManifold1DResult
  }
  WasmEqManifold2DRunner: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    systemType: string,
    equilibriumState: Float64Array,
    settings: Record<string, unknown>
  ) => {
    run_steps: (batchSize: number) => ContinuationProgress
    get_progress: () => ContinuationProgress
    get_result: () => EquilibriumManifold2DResult
  }
  WasmCycleManifold2DRunner: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    systemType: string,
    cycleState: Float64Array,
    ntst: number,
    ncol: number,
    floquetMultipliers: Array<{ re: number; im: number }>,
    settings: Record<string, unknown>
  ) => {
    run_steps: (batchSize: number) => ContinuationProgress
    get_progress: () => ContinuationProgress
    get_result: () => LimitCycleManifold2DResult
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
  WasmIsochroneCurveRunner: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    lcState: Float64Array,
    period: number,
    param1Name: string,
    param1Value: number,
    param2Name: string,
    param2Value: number,
    ntst: number,
    ncol: number,
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
  WasmHomoclinicRunner: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    setup: unknown,
    settings: Record<string, number>,
    forward: boolean
  ) => {
    run_steps: (batchSize: number) => ContinuationProgress
    get_progress: () => ContinuationProgress
    get_result: () => HomoclinicContinuationResult
  }
  WasmHomotopySaddleRunner: new (
    equations: string[],
    params: Float64Array,
    paramNames: string[],
    varNames: string[],
    setup: unknown,
    settings: Record<string, number>,
    forward: boolean
  ) => {
    run_steps: (batchSize: number) => ContinuationProgress
    get_progress: () => ContinuationProgress
    get_result: () => HomotopySaddleContinuationResult
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

async function runComputeEventSeriesFromOrbit(
  request: ComputeEventSeriesFromOrbitRequest,
  signal: AbortSignal
): Promise<EventSeriesResult> {
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

  const computeEventSeries =
    system.compute_event_series_from_orbit ?? system.computeEventSeriesFromOrbit
  if (typeof computeEventSeries !== 'function') {
    throw new Error(
      'Event-series computation is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
    )
  }
  const result = computeEventSeries.call(system, {
    var_names: request.system.varNames,
    param_names: request.system.paramNames,
    initial_state: request.initialState,
    start_time: request.startTime,
    steps: request.steps,
    dt: request.dt,
    mode: request.mode,
    event_expression: request.eventExpression,
    event_level: request.eventLevel,
    observable_expressions: request.observableExpressions,
  })
  abortIfNeeded(signal)
  return result
}

async function runComputeEventSeriesFromSamples(
  request: ComputeEventSeriesFromSamplesRequest,
  signal: AbortSignal
): Promise<EventSeriesResult> {
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

  const computeEventSeries =
    system.compute_event_series_from_samples ?? system.computeEventSeriesFromSamples
  if (typeof computeEventSeries !== 'function') {
    throw new Error(
      'Event-series computation is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
    )
  }
  const result = computeEventSeries.call(system, {
    var_names: request.system.varNames,
    param_names: request.system.paramNames,
    samples: request.samples.map((sample) => ({
      state: sample.state,
      time: sample.time ?? null,
    })),
    mode: request.mode,
    event_expression: request.eventExpression,
    event_level: request.eventLevel,
    observable_expressions: request.observableExpressions,
  })
  abortIfNeeded(signal)
  return result
}

async function runComputeIsocline(
  request: ComputeIsoclineRequest,
  signal: AbortSignal
): Promise<ComputeIsoclineResult> {
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

  const axisIndices = request.axes.map((axis) => request.system.varNames.indexOf(axis.variableName))
  if (axisIndices.some((index) => index < 0)) {
    throw new Error('Isocline axis variable is not part of the system state variables.')
  }
  const axisMins = request.axes.map((axis) => axis.min)
  const axisMaxs = request.axes.map((axis) => axis.max)
  const axisSamples = request.axes.map((axis) => axis.samples)
  const computeIsocline = system.compute_isocline ?? system.computeIsocline
  if (typeof computeIsocline !== 'function') {
    throw new Error(
      'Isocline computation is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
    )
  }
  const result = computeIsocline.call(
    system,
    request.expression,
    request.level,
    axisIndices,
    axisMins,
    axisMaxs,
    axisSamples,
    request.frozenState,
    request.system.varNames,
    request.system.paramNames
  )
  abortIfNeeded(signal)
  return result
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

function createPowerSpectrumAccumulator(
  wasm: WasmModule,
  sampleInterval: number,
  windowSize: number
) {
  if (!Number.isFinite(sampleInterval) || sampleInterval <= 0) {
    throw new Error('Power spectrum sample interval must be positive.')
  }
  if (!Number.isFinite(windowSize) || windowSize < 2) {
    throw new Error('Power spectrum window size must be at least 2.')
  }
  if (!wasm.WasmPowerSpectrumAccumulator) {
    throw new Error(
      'Power spectrum computation is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
    )
  }
  return new wasm.WasmPowerSpectrumAccumulator(sampleInterval, Math.trunc(windowSize))
}

async function runPowerSpectrumFromSamples(
  request: PowerSpectrumSamplesRequest,
  signal: AbortSignal
): Promise<PowerSpectrumResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const accumulator = createPowerSpectrumAccumulator(
    wasm,
    request.sampleInterval,
    request.windowSize
  )
  abortIfNeeded(signal)
  accumulator.push_samples(request.samples)
  abortIfNeeded(signal)
  return accumulator.finish()
}

async function runPowerSpectrumFromOrbit(
  request: PowerSpectrumOrbitRequest,
  signal: AbortSignal
): Promise<PowerSpectrumResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const { system: config } = request
  if (config.type === 'data') {
    throw new Error('Use the CSV data path for Data systems.')
  }
  const observableIndex = Math.trunc(request.observableIndex)
  if (observableIndex < 0 || observableIndex >= config.varNames.length) {
    throw new Error('Power spectrum observable is not part of the system state.')
  }

  const system = new wasm.WasmSystem(
    config.equations,
    new Float64Array(config.params),
    config.paramNames,
    config.varNames,
    config.solver,
    config.type
  )
  const accumulator = createPowerSpectrumAccumulator(wasm, request.dt, request.windowSize)
  system.set_t(0)
  system.set_state(new Float64Array(request.initialState))
  accumulator.push_samples([system.get_state()[observableIndex] ?? Number.NaN])
  for (let step = 0; step < request.steps; step += 1) {
    abortIfNeeded(signal)
    system.step(request.dt)
    accumulator.push_samples([system.get_state()[observableIndex] ?? Number.NaN])
  }
  abortIfNeeded(signal)
  return accumulator.finish()
}

type CsvPreviewResult = NonNullable<PowerSpectrumResult['preview']>

class CsvPreviewSampler {
  private stride = 1
  private rowIndices: number[] = []
  private rows: number[][] = []
  private lastRowIndex = -1
  private lastValues: number[] = []

  push(rowIndex: number, values: number[]) {
    this.lastRowIndex = rowIndex
    this.lastValues = [...values]
    if (rowIndex % this.stride !== 0) return
    if (this.rows.length >= MAX_DATASET_PREVIEW_ROWS) {
      this.stride *= 2
      const nextIndices: number[] = []
      const nextRows: number[][] = []
      for (let index = 0; index < this.rowIndices.length; index += 1) {
        const sourceIndex = this.rowIndices[index]
        if (sourceIndex === undefined || sourceIndex % this.stride !== 0) continue
        nextIndices.push(sourceIndex)
        nextRows.push(this.rows[index] ?? [])
      }
      this.rowIndices = nextIndices
      this.rows = nextRows
    }
    if (rowIndex % this.stride !== 0) return
    this.rowIndices.push(rowIndex)
    this.rows.push([...values])
  }

  finish(columns: string[], sampleInterval: number, rowCount: number): CsvPreviewResult {
    if (
      this.lastRowIndex >= 0 &&
      this.rowIndices[this.rowIndices.length - 1] !== this.lastRowIndex
    ) {
      if (this.rows.length >= MAX_DATASET_PREVIEW_ROWS) {
        this.rowIndices.shift()
        this.rows.shift()
      }
      this.rowIndices.push(this.lastRowIndex)
      this.rows.push([...this.lastValues])
    }
    return {
      columns,
      sample_interval: sampleInterval,
      row_count: rowCount,
      stride: this.stride,
      row_indices: [...this.rowIndices],
      rows: this.rows.map((row) => [...row]),
    }
  }
}

function fallbackCsvColumnNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `column_${index + 1}`)
}

function normalizeCsvColumnNames(rawColumns: string[]): string[] {
  const used = new Map<string, number>()
  return rawColumns.map((raw, index) => {
    const base = raw.trim() || `column_${index + 1}`
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    return seen === 0 ? base : `${base}_${seen + 1}`
  })
}

function parseCsvNumericRow(line: string, delimiter: string, lineNumber: number): number[] | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const columns = trimmed.split(delimiter)
  return columns.map((raw, index) => {
    const value = Number(raw.trim())
    if (!Number.isFinite(value)) {
      throw new Error(`CSV row ${lineNumber} column ${index + 1} is not numeric.`)
    }
    return value
  })
}

async function runPowerSpectrumFromCsvFile(
  request: PowerSpectrumCsvFileRequest,
  signal: AbortSignal
): Promise<PowerSpectrumResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const accumulator = createPowerSpectrumAccumulator(
    wasm,
    request.sampleInterval,
    request.windowSize
  )
  const columnIndex = Math.max(0, Math.trunc(request.columnIndex))
  const delimiter = request.delimiter ?? ','
  const reader = request.file.stream().getReader()
  const decoder = new TextDecoder()
  const batch: number[] = []
  const previewSampler = new CsvPreviewSampler()
  let pending = ''
  let lineNumber = 0
  let headerSkipped = !request.hasHeader
  let columnNames: string[] | null = null
  let rowCount = 0

  const flushBatch = () => {
    if (batch.length === 0) return
    accumulator.push_samples(batch.splice(0))
  }

  const processLine = (line: string) => {
    lineNumber += 1
    if (!headerSkipped) {
      columnNames = normalizeCsvColumnNames(line.split(delimiter))
      headerSkipped = true
      return
    }
    const values = parseCsvNumericRow(line, delimiter, lineNumber)
    if (!values) return
    if (columnIndex >= values.length) {
      throw new Error(`CSV row ${lineNumber} has no column ${columnIndex + 1}.`)
    }
    if (!columnNames) {
      columnNames = fallbackCsvColumnNames(values.length)
    }
    if (values.length !== columnNames.length) {
      throw new Error(
        `CSV row ${lineNumber} has ${values.length} columns; expected ${columnNames.length}.`
      )
    }
    batch.push(values[columnIndex] ?? Number.NaN)
    previewSampler.push(rowCount, values)
    rowCount += 1
    if (batch.length >= 4096) {
      flushBatch()
    }
  }

  while (true) {
    abortIfNeeded(signal)
    const { value, done } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) {
      processLine(line)
    }
  }

  pending += decoder.decode()
  if (pending.trim().length > 0) {
    processLine(pending)
  }
  flushBatch()
  abortIfNeeded(signal)
  const result = accumulator.finish()
  const columns = columnNames ?? fallbackCsvColumnNames(columnIndex + 1)
  return {
    ...result,
    column_names: columns,
    preview: previewSampler.finish(columns, request.sampleInterval, rowCount),
  }
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
    type === 'IsochroneCurve' ||
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

async function runEquilibriumManifold1D(
  request: EquilibriumManifold1DRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<EquilibriumManifold1DResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const runner = new wasm.WasmEqManifold1DRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.type,
    request.mapIterations ?? 1,
    new Float64Array(request.equilibriumState),
    { ...request.settings }
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

async function runEquilibriumManifold2D(
  request: EquilibriumManifold2DRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<EquilibriumManifold2DResult> {
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

  const computeWithProgress = system.compute_eq_manifold_2d_with_progress
  if (typeof computeWithProgress === 'function') {
    return computeWithProgress.call(
      system,
      new Float64Array(request.equilibriumState),
      { ...request.settings },
      (progress: ContinuationProgress) => {
        onProgress(progress)
      }
    )
  }

  const runner = new wasm.WasmEqManifold2DRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.type,
    new Float64Array(request.equilibriumState),
    { ...request.settings }
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

async function runLimitCycleManifold2D(
  request: LimitCycleManifold2DRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<LimitCycleManifold2DResult> {
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

  const computeWithProgress = system.compute_cycle_manifold_2d_with_progress
  if (typeof computeWithProgress === 'function') {
    return computeWithProgress.call(
      system,
      new Float64Array(request.cycleState),
      request.ntst,
      request.ncol,
      request.floquetMultipliers,
      { ...request.settings },
      (progress: ContinuationProgress) => {
        onProgress(progress)
      }
    )
  }

  const runner = new wasm.WasmCycleManifold2DRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.type,
    new Float64Array(request.cycleState),
    request.ntst,
    request.ncol,
    request.floquetMultipliers,
    { ...request.settings }
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

async function runComputeLimitCycleFloquetModes(
  request: LimitCycleFloquetModesRequest,
  signal: AbortSignal
): Promise<LimitCycleFloquetModesResult> {
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
  const computeModes = system.compute_limit_cycle_floquet_modes
  if (typeof computeModes !== 'function') {
    throw new Error(
      'Floquet mode computation is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
    )
  }
  return computeModes.call(
    system,
    new Float64Array(request.cycleState),
    request.ntst,
    request.ncol,
    request.parameterName
  )
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

async function runIsochroneCurveContinuation(
  request: IsochroneCurveContinuationRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<Codim1CurveBranch> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const settings: Record<string, number> = { ...request.settings }
  const runnerCtor = (wasm as { WasmIsochroneCurveRunner?: WasmModule['WasmIsochroneCurveRunner'] })
    .WasmIsochroneCurveRunner
  if (typeof runnerCtor !== 'function') {
    const system = new wasm.WasmSystem(
      request.system.equations,
      new Float64Array(request.system.params),
      request.system.paramNames,
      request.system.varNames,
      request.system.solver,
      request.system.type
    )
    const continueIsochrone = (
      system as unknown as {
        continue_isochrone_curve?: (
          lcState: Float64Array,
          period: number,
          param1Name: string,
          param1Value: number,
          param2Name: string,
          param2Value: number,
          ntst: number,
          ncol: number,
          settings: Record<string, number>,
          forward: boolean
        ) => Codim1CurveBranch
      }
    ).continue_isochrone_curve
    if (typeof continueIsochrone !== 'function') {
      throw new Error(
        'Isochrone continuation is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
      )
    }

    const maxSteps =
      Number.isFinite(settings.max_steps) && settings.max_steps > 0
        ? settings.max_steps
        : 0
    onProgress({
      done: false,
      current_step: 0,
      max_steps: maxSteps,
      points_computed: 0,
      bifurcations_found: 0,
      current_param: request.param1Value,
    })
    abortIfNeeded(signal)
    const result = continueIsochrone.call(
      system as unknown as object,
      new Float64Array(request.lcState),
      request.period,
      request.param1Name,
      request.param1Value,
      request.param2Name,
      request.param2Value,
      request.ntst,
      request.ncol,
      settings,
      request.forward
    )
    const finalParam =
      result.points[result.points.length - 1]?.param1_value ?? request.param1Value
    onProgress({
      done: true,
      current_step: maxSteps,
      max_steps: maxSteps,
      points_computed: result.points.length,
      bifurcations_found: result.codim2_bifurcations?.length ?? 0,
      current_param: finalParam,
    })
    return result
  }

  const runner = new runnerCtor(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    new Float64Array(request.lcState),
    request.period,
    request.param1Name,
    request.param1Value,
    request.param2Name,
    request.param2Value,
    request.ntst,
    request.ncol,
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

async function runHomoclinicFromLargeCycle(
  request: HomoclinicFromLargeCycleRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<HomoclinicContinuationResult> {
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

  const initHomoclinicFromLargeCycle = system.init_homoclinic_from_large_cycle
  if (typeof initHomoclinicFromLargeCycle !== 'function') {
    throw new Error(
      'Homoclinic initialization from large cycle is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
    )
  }
  const setup = initHomoclinicFromLargeCycle.call(
    system,
    new Float64Array(request.lcState),
    request.sourceNtst,
    request.sourceNcol,
    request.parameterName,
    request.param2Name,
    request.targetNtst,
    request.targetNcol,
    request.freeTime,
    request.freeEps0,
    request.freeEps1
  )

  const settings: Record<string, number> = { ...request.settings }
  const HomoclinicRunner = wasm.WasmHomoclinicRunner
  if (typeof HomoclinicRunner !== 'function') {
    throw new Error(
      'Homoclinic continuation is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
    )
  }
  const runner = new HomoclinicRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    setup,
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

  return discardHomoclinicInitialApproximationPoint(runner.get_result())
}

async function runHomoclinicFromHomoclinic(
  request: HomoclinicFromHomoclinicRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<HomoclinicContinuationResult> {
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

  const initHomoclinicFromHomoclinic = system.init_homoclinic_from_homoclinic
  if (typeof initHomoclinicFromHomoclinic !== 'function') {
    throw new Error(
      'Homoclinic reinitialization is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
    )
  }
  const setup = initHomoclinicFromHomoclinic.call(
    system,
    new Float64Array(request.pointState),
    request.sourceNtst,
    request.sourceNcol,
    request.sourceFreeTime,
    request.sourceFreeEps0,
    request.sourceFreeEps1,
    request.sourceFixedTime,
    request.sourceFixedEps0,
    request.sourceFixedEps1,
    request.parameterName,
    request.param2Name,
    request.targetNtst,
    request.targetNcol,
    request.freeTime,
    request.freeEps0,
    request.freeEps1
  )

  const settings: Record<string, number> = { ...request.settings }
  const HomoclinicRunner = wasm.WasmHomoclinicRunner
  if (typeof HomoclinicRunner !== 'function') {
    throw new Error(
      'Homoclinic continuation is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
    )
  }
  const runner = new HomoclinicRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    setup,
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

async function runHomotopySaddleFromEquilibrium(
  request: HomotopySaddleFromEquilibriumRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<HomotopySaddleContinuationResult> {
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

  const initHomotopySaddleFromEquilibrium = system.init_homotopy_saddle_from_equilibrium
  if (typeof initHomotopySaddleFromEquilibrium !== 'function') {
    throw new Error(
      'Homotopy-saddle initialization is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
    )
  }
  const setup = initHomotopySaddleFromEquilibrium.call(
    system,
    new Float64Array(request.equilibriumState),
    request.parameterName,
    request.param2Name,
    request.ntst,
    request.ncol,
    request.eps0,
    request.eps1,
    request.time,
    request.eps1Tol
  )

  const settings: Record<string, number> = { ...request.settings }
  const HomotopySaddleRunner = wasm.WasmHomotopySaddleRunner
  if (typeof HomotopySaddleRunner !== 'function') {
    throw new Error(
      'Homotopy-saddle continuation is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
    )
  }
  const runner = new HomotopySaddleRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    setup,
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

async function runHomoclinicFromHomotopySaddle(
  request: HomoclinicFromHomotopySaddleRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<HomoclinicContinuationResult> {
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

  const initHomoclinicFromHomotopySaddle = system.init_homoclinic_from_homotopy_saddle
  if (typeof initHomoclinicFromHomotopySaddle !== 'function') {
    throw new Error(
      'Homoclinic initialization from homotopy-saddle is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
    )
  }
  const setup = initHomoclinicFromHomotopySaddle.call(
    system,
    new Float64Array(request.stageDState),
    request.sourceNtst,
    request.sourceNcol,
    request.parameterName,
    request.param2Name,
    request.targetNtst,
    request.targetNcol,
    request.freeTime,
    request.freeEps0,
    request.freeEps1
  )

  const settings: Record<string, number> = { ...request.settings }
  const HomoclinicRunner = wasm.WasmHomoclinicRunner
  if (typeof HomoclinicRunner !== 'function') {
    throw new Error(
      'Homoclinic continuation is unavailable in this WASM build. Rebuild fork_wasm pkg-web.'
    )
  }
  const runner = new HomoclinicRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    setup,
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
  if (system.type === 'data') {
    return { ok: true, equationErrors }
  }

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

    if (message.kind === 'computeEventSeriesFromOrbit') {
      const result = await runComputeEventSeriesFromOrbit(message.payload, controller.signal)
      const response: WorkerResponse = { id: message.id, ok: true, result }
      ctx.postMessage(response)
      return
    }

    if (message.kind === 'computeEventSeriesFromSamples') {
      const result = await runComputeEventSeriesFromSamples(message.payload, controller.signal)
      const response: WorkerResponse = { id: message.id, ok: true, result }
      ctx.postMessage(response)
      return
    }

    if (message.kind === 'computeIsocline') {
      const result = await runComputeIsocline(message.payload, controller.signal)
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

    if (message.kind === 'computePowerSpectrumFromSamples') {
      const result = await runPowerSpectrumFromSamples(message.payload, controller.signal)
      const response: WorkerResponse = { id: message.id, ok: true, result }
      ctx.postMessage(response)
      return
    }

    if (message.kind === 'computePowerSpectrumFromOrbit') {
      const result = await runPowerSpectrumFromOrbit(message.payload, controller.signal)
      const response: WorkerResponse = { id: message.id, ok: true, result }
      ctx.postMessage(response)
      return
    }

    if (message.kind === 'computePowerSpectrumFromCsvFile') {
      const result = await runPowerSpectrumFromCsvFile(message.payload, controller.signal)
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

    if (message.kind === 'runEquilibriumManifold1D') {
      const result = await runEquilibriumManifold1D(
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

    if (message.kind === 'runEquilibriumManifold2D') {
      const result = await runEquilibriumManifold2D(
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

    if (message.kind === 'runLimitCycleManifold2D') {
      const result = await runLimitCycleManifold2D(
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

    if (message.kind === 'computeLimitCycleFloquetModes') {
      const result = await runComputeLimitCycleFloquetModes(
        message.payload,
        controller.signal
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

    if (message.kind === 'runIsochroneCurveContinuation') {
      const result = await runIsochroneCurveContinuation(
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

    if (message.kind === 'runHomoclinicFromLargeCycle') {
      const result = await runHomoclinicFromLargeCycle(
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

    if (message.kind === 'runHomoclinicFromHomoclinic') {
      const result = await runHomoclinicFromHomoclinic(
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

    if (message.kind === 'runHomotopySaddleFromEquilibrium') {
      const result = await runHomotopySaddleFromEquilibrium(
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

    if (message.kind === 'runHomoclinicFromHomotopySaddle') {
      const result = await runHomoclinicFromHomotopySaddle(
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
