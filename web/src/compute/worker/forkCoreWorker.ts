/// <reference lib="webworker" />

import type {
  ComputeEventSeriesFromOrbitRequest,
  ComputeEventSeriesFromSamplesRequest,
  ComputeIsoclineRequest,
  ComputeIsoclineResult,
  Codim1CurveBranch,
  Codim2BranchSeed,
  Codim2BranchSwitchRequest,
  Codim2BranchSwitchResult,
  ContinuationProgress,
  ContinuationExtensionRequest,
  ContinuationExtensionResult,
  CovariantLyapunovRequest,
  CovariantLyapunovResponse,
  EquilibriumContinuationRequest,
  EquilibriumContinuationResult,
  EquilibriumManifold1DRequest,
  EquilibriumManifold1DResult,
  EquilibriumManifold1DExtensionRequest,
  EquilibriumManifold1DExtensionResult,
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
  Manifold2DExtensionRequest,
  Manifold2DExtensionResult,
  LyapunovExponentsRequest,
  MapCycleContinuationFromPDRequest,
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
import { periodicPeriodsForConfig } from '../../system/periodicity'
import type { SystemConfig } from '../../system/types'
import { runSteppedRunnerToCompletion } from './steppedRunner'
import { createWorkerSuccessResponse, getComputeHandler } from '../computeProtocol'
import type {
  ComputeHandlerMap,
  ComputeOperationKind,
  WorkerOperationRequest,
  WorkerRequest,
  WorkerResponse,
} from '../computeProtocol'

type WasmModule = typeof import('@fork-wasm')
type GeneratedWasmSystem = InstanceType<WasmModule['WasmSystem']>
type WasmSystem = Omit<
  GeneratedWasmSystem,
  | 'compute_event_series_from_orbit'
  | 'compute_event_series_from_samples'
  | 'compute_isocline'
> & {
  compute_event_series_from_orbit?: GeneratedWasmSystem['compute_event_series_from_orbit']
  computeEventSeriesFromOrbit?: GeneratedWasmSystem['compute_event_series_from_orbit']
  compute_event_series_from_samples?: GeneratedWasmSystem['compute_event_series_from_samples']
  computeEventSeriesFromSamples?: GeneratedWasmSystem['compute_event_series_from_samples']
  compute_isocline?: GeneratedWasmSystem['compute_isocline']
  computeIsocline?: GeneratedWasmSystem['compute_isocline']
}

const pendingControllers = new Map<string, AbortController>()

let wasmPromise: Promise<WasmModule> | null = null

async function loadWasm(): Promise<WasmModule> {
  if (!wasmPromise) {
    wasmPromise = import('@fork-wasm').then(async (module) => {
      await module.default()
      return module
    })
  }
  return wasmPromise
}

function createWasmSystem(wasm: WasmModule, system: SystemConfig): WasmSystem {
  const instance = new wasm.WasmSystem(
    system.equations,
    new Float64Array(system.params),
    system.paramNames,
    system.varNames,
    system.solver,
    system.type
  ) as WasmSystem
  instance.set_periods(new Float64Array(periodicPeriodsForConfig(system)))
  return instance
}

async function runOrbit(request: SimulateOrbitRequest, signal: AbortSignal): Promise<SimulateOrbitResult> {
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)

  system.set_t(0)
  system.set_state(new Float64Array(request.initialState))

  const data: number[][] = []
  let t = 0
  data.push([t, ...Array.from(system.get_state())])

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

  const system = createWasmSystem(wasm, config)

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
  const system = createWasmSystem(wasm, request.system)
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
  const system = createWasmSystem(wasm, request.system)
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
  const system = createWasmSystem(wasm, request.system)
  abortIfNeeded(signal)

  const axisIndices = request.axes.map((axis) => request.system.varNames.indexOf(axis.variableName))
  if (axisIndices.some((index) => index < 0)) {
    throw new Error('Isocline axis variable is not part of the system state variables.')
  }
  const axisIndexValues = Uint32Array.from(axisIndices)
  const axisMins = Float64Array.from(request.axes.map((axis) => axis.min))
  const axisMaxs = Float64Array.from(request.axes.map((axis) => axis.max))
  const axisSamples = Uint32Array.from(request.axes.map((axis) => axis.samples))
  const frozenState = Float64Array.from(request.frozenState)
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
    axisIndexValues,
    axisMins,
    axisMaxs,
    axisSamples,
    frozenState,
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
  const system = createWasmSystem(wasm, request.system)
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
  const system = createWasmSystem(wasm, request.system)
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
  const system = createWasmSystem(wasm, request.system)
  abortIfNeeded(signal)
  const mapIterations =
    request.system.type === 'map' ? request.mapIterations ?? 1 : 1
  return system.solve_equilibrium(
    new Float64Array(request.initialGuess),
    request.maxSteps,
    request.dampingFactor,
    mapIterations
  )
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
    request.forward,
    new Float64Array(periodicPeriodsForConfig(request.system))
  )

  return runSteppedRunnerToCompletion(runner, signal, onProgress)
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

  return runSteppedRunnerToCompletion(runner, signal, onProgress)
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
    { ...request.settings },
    new Float64Array(periodicPeriodsForConfig(request.system))
  )
  return runSteppedRunnerToCompletion(runner, signal, onProgress)
}

async function runEquilibriumManifold1DExtension(
  request: EquilibriumManifold1DExtensionRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<EquilibriumManifold1DExtensionResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const runner = new wasm.WasmEqManifold1DExtensionRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.type,
    request.mapIterations ?? 1,
    request.branchData,
    { ...request.settings },
    new Float64Array(periodicPeriodsForConfig(request.system))
  )
  return runSteppedRunnerToCompletion(runner, signal, onProgress)
}

async function runManifold2DExtension(
  request: Manifold2DExtensionRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<Manifold2DExtensionResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)
  const extendWithProgress = system.extend_manifold_2d_with_progress
  if (typeof extendWithProgress === 'function') {
    return extendWithProgress.call(
      system,
      request.branchData,
      { ...request.settings },
      (progress: ContinuationProgress) => {
        abortIfNeeded(signal)
        onProgress(progress)
      }
    )
  }

  const runner = new wasm.WasmManifold2DExtensionRunner(
    request.system.equations,
    new Float64Array(request.system.params),
    request.system.paramNames,
    request.system.varNames,
    request.system.type,
    request.branchData,
    { ...request.settings }
  )
  return runSteppedRunnerToCompletion(runner, signal, onProgress)
}

async function runEquilibriumManifold2D(
  request: EquilibriumManifold2DRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<EquilibriumManifold2DResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)

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
  return runSteppedRunnerToCompletion(runner, signal, onProgress)
}

async function runLimitCycleManifold2D(
  request: LimitCycleManifold2DRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<LimitCycleManifold2DResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)

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
  return runSteppedRunnerToCompletion(runner, signal, onProgress)
}

async function runComputeLimitCycleFloquetModes(
  request: LimitCycleFloquetModesRequest,
  signal: AbortSignal
): Promise<LimitCycleFloquetModesResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)
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

  return runSteppedRunnerToCompletion(runner, signal, onProgress)
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

  return runSteppedRunnerToCompletion(runner, signal, onProgress)
}

async function runCodim2BranchSwitch(
  request: Codim2BranchSwitchRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<Codim2BranchSwitchResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)
  const settings: Record<string, number> = { ...request.settings }

  if (request.sourceType === 'GeneralizedHopf') {
    if (request.target !== 'LimitPointCycle') {
      throw new Error('Generalized-Hopf points can switch only to an LPC curve.')
    }
    if (
      !request.neighborState ||
      request.neighborParam1Value === undefined ||
      request.neighborParam2Value === undefined ||
      request.auxiliary === undefined ||
      request.neighborAuxiliary === undefined ||
      request.neighborTestValue === undefined ||
      request.secondLyapunov === undefined
    ) {
      throw new Error('Generalized-Hopf branch switching is missing source-segment data.')
    }
    const initializer = (system as unknown as {
      init_lpc_from_generalized_hopf?: (...args: unknown[]) => Codim2BranchSeed
    }).init_lpc_from_generalized_hopf
    if (typeof initializer !== 'function') {
      throw new Error('Generalized-Hopf LPC switching is unavailable in this WASM build.')
    }
    const seed = initializer.call(
      system,
      new Float64Array(request.state),
      new Float64Array(request.neighborState),
      request.param1Name,
      request.param2Name,
      request.param1Value,
      request.param2Value,
      request.neighborParam1Value,
      request.neighborParam2Value,
      request.auxiliary,
      request.neighborAuxiliary,
      request.neighborTestValue,
      request.secondLyapunov,
      request.perturbation,
      request.ntst,
      request.ncol,
      request.tolerance
    )
    const runner = new wasm.WasmLPCCurveRunner(
      request.system.equations,
      new Float64Array(request.system.params),
      request.system.paramNames,
      request.system.varNames,
      new Float64Array(seed.state),
      seed.period ?? 0,
      request.param1Name,
      seed.param1_value,
      request.param2Name,
      seed.param2_value,
      seed.ntst ?? request.ntst,
      seed.ncol ?? request.ncol,
      settings,
      request.forward
    )
    const branch = await runSteppedRunnerToCompletion(runner, signal, onProgress)
    return { target: request.target, branch, seed }
  }

  if (request.sourceType !== 'BogdanovTakens') {
    throw new Error(`Unsupported codimension-two source: ${request.sourceType}`)
  }
  if (request.target === 'Homoclinic') {
    const initializer = (system as unknown as {
      init_homoclinic_from_bogdanov_takens?: (...args: unknown[]) => {
        setup: unknown
        predictor_residual: number
        corrected_residual: number
      }
    }).init_homoclinic_from_bogdanov_takens
    if (typeof initializer !== 'function') {
      throw new Error('Bogdanov-Takens homoclinic switching is unavailable in this WASM build.')
    }
    const seed = initializer.call(
      system,
      new Float64Array(request.state),
      request.param1Name,
      request.param2Name,
      request.param1Value,
      request.param2Value,
      request.perturbation,
      request.ntst,
      request.ncol,
      request.tolerance
    )
    const runner = new wasm.WasmHomoclinicRunner(
      request.system.equations,
      new Float64Array(request.system.params),
      request.system.paramNames,
      request.system.varNames,
      seed.setup,
      settings,
      request.forward
    )
    const branch = await runSteppedRunnerToCompletion(runner, signal, onProgress)
    return { target: request.target, branch, seed }
  }

  if (request.target !== 'Fold' && request.target !== 'Hopf') {
    throw new Error(`Bogdanov-Takens cannot switch to ${request.target}.`)
  }
  const initializer = (system as unknown as {
    init_curves_from_bogdanov_takens?: (...args: unknown[]) => [Codim2BranchSeed, Codim2BranchSeed]
  }).init_curves_from_bogdanov_takens
  if (typeof initializer !== 'function') {
    throw new Error('Bogdanov-Takens curve switching is unavailable in this WASM build.')
  }
  const seeds = initializer.call(
    system,
    new Float64Array(request.state),
    request.param1Name,
    request.param2Name,
    request.param1Value,
    request.param2Value,
    request.perturbation,
    request.tolerance
  )
  const seed = request.target === 'Fold' ? seeds[0] : seeds[1]
  const runner = request.target === 'Fold'
    ? new wasm.WasmFoldCurveRunner(
        request.system.equations,
        new Float64Array(request.system.params),
        request.system.paramNames,
        request.system.varNames,
        request.system.type,
        1,
        new Float64Array(seed.state),
        request.param1Name,
        seed.param1_value,
        request.param2Name,
        seed.param2_value,
        settings,
        request.forward
      )
    : new wasm.WasmHopfCurveRunner(
        request.system.equations,
        new Float64Array(request.system.params),
        request.system.paramNames,
        request.system.varNames,
        request.system.type,
        1,
        new Float64Array(seed.state),
        Math.sqrt(seed.auxiliary ?? 0),
        request.param1Name,
        seed.param1_value,
        request.param2Name,
        seed.param2_value,
        settings,
        request.forward
      )
  const branch = await runSteppedRunnerToCompletion(runner, signal, onProgress)
  return { target: request.target, branch, seed }
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
    const system = createWasmSystem(wasm, request.system)
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

  return runSteppedRunnerToCompletion(runner, signal, onProgress)
}

async function runLimitCycleContinuationFromHopf(
  request: LimitCycleContinuationFromHopfRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<LimitCycleContinuationResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)

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

  return runSteppedRunnerToCompletion(runner, signal, onProgress)
}

async function runLimitCycleContinuationFromOrbit(
  request: LimitCycleContinuationFromOrbitRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<LimitCycleContinuationResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)

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

  return runSteppedRunnerToCompletion(runner, signal, onProgress)
}

async function runLimitCycleContinuationFromPD(
  request: LimitCycleContinuationFromPDRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<LimitCycleContinuationResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)

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

  return runSteppedRunnerToCompletion(runner, signal, onProgress)
}

async function runHomoclinicFromLargeCycle(
  request: HomoclinicFromLargeCycleRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<HomoclinicContinuationResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)

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

  return discardHomoclinicInitialApproximationPoint(
    runSteppedRunnerToCompletion(runner, signal, onProgress)
  )
}

async function runHomoclinicFromHomoclinic(
  request: HomoclinicFromHomoclinicRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<HomoclinicContinuationResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)

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

  return runSteppedRunnerToCompletion(runner, signal, onProgress)
}

async function runHomotopySaddleFromEquilibrium(
  request: HomotopySaddleFromEquilibriumRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<HomotopySaddleContinuationResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)

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

  return runSteppedRunnerToCompletion(runner, signal, onProgress)
}

async function runHomoclinicFromHomotopySaddle(
  request: HomoclinicFromHomotopySaddleRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<HomoclinicContinuationResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)

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

  return runSteppedRunnerToCompletion(runner, signal, onProgress)
}

async function runMapCycleContinuationFromPD(
  request: MapCycleContinuationFromPDRequest,
  signal: AbortSignal,
  onProgress: (progress: ContinuationProgress) => void
): Promise<EquilibriumContinuationResult> {
  abortIfNeeded(signal)
  const wasm = await loadWasm()
  const system = createWasmSystem(wasm, request.system)

  let seed = system.init_map_cycle_from_pd(
    new Float64Array(request.pdState),
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
      new Float64Array(seed),
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
    const instance = createWasmSystem(wasm, system)
    void instance
    return { ok: true, equationErrors }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    for (let i = 0; i < system.equations.length; i += 1) {
      abortIfNeeded(signal)
      try {
        const instance = createWasmSystem(wasm, {
          ...system,
          equations: [system.equations[i]],
        })
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

const handlers = {
  simulateOrbit: runOrbit,
  sampleMap1DFunction: runSampleMap1DFunction,
  computeEventSeriesFromOrbit: runComputeEventSeriesFromOrbit,
  computeEventSeriesFromSamples: runComputeEventSeriesFromSamples,
  computeIsocline: runComputeIsocline,
  computeLyapunovExponents: runLyapunovExponents,
  computeCovariantLyapunovVectors: runCovariantLyapunovVectors,
  solveEquilibrium: runSolveEquilibrium,
  runEquilibriumContinuation,
  runContinuationExtension,
  runEquilibriumManifold1D,
  runEquilibriumManifold1DExtension,
  runManifold2DExtension,
  runEquilibriumManifold2D,
  runLimitCycleManifold2D,
  computeLimitCycleFloquetModes: runComputeLimitCycleFloquetModes,
  runFoldCurveContinuation,
  runHopfCurveContinuation,
  runCodim2BranchSwitch,
  runIsochroneCurveContinuation,
  runLimitCycleContinuationFromHopf,
  runLimitCycleContinuationFromOrbit,
  runLimitCycleContinuationFromPD,
  runHomoclinicFromLargeCycle,
  runHomoclinicFromHomoclinic,
  runHomotopySaddleFromEquilibrium,
  runHomoclinicFromHomotopySaddle,
  runMapCycleContinuationFromPD,
  validateSystem: runValidateSystem,
} satisfies ComputeHandlerMap

const ctx = self as DedicatedWorkerGlobalScope

async function dispatchWorkerOperation<K extends ComputeOperationKind>(
  message: WorkerOperationRequest<K>,
  controller: AbortController
): Promise<void> {
  const handler = getComputeHandler(handlers, message.kind)
  const result = await handler(message.payload, controller.signal, (progress) => {
    const response: WorkerResponse = { id: message.id, kind: 'progress', progress }
    ctx.postMessage(response)
  })
  ctx.postMessage(createWorkerSuccessResponse(message, result))
}

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
    await dispatchWorkerOperation(message, controller)
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
