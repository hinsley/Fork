import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  ComputeIsoclineRequest,
  ComputeIsoclineResult,
  ContinuationProgress,
  EquilibriumContinuationRequest,
  EquilibriumContinuationResult,
  ForcedPeriodicResponseContinuationRequest,
  ForcedPeriodicResponseContinuationResult,
  SimulateOrbitRequest,
  SimulateOrbitResult,
  SolveEquilibriumRequest,
  SolveEquilibriumResult,
  SolveForcedPeriodicResponseRequest,
  SolveForcedPeriodicResponseResult,
} from './ForkCoreClient'
import {
  computeOperationKinds,
  computeOperationMetadata,
  createWorkerRequest,
  progressOperationKinds,
} from './computeProtocol'
import type {
  ComputeOperationKind,
  ComputeRequest,
  ComputeResult,
  ProgressOperationKind,
  WorkerOperationRequest,
} from './computeProtocol'

const expectedOperationKinds = [
  'simulateOrbit',
  'sampleMap1DFunction',
  'computeEventSeriesFromOrbit',
  'computeEventSeriesFromSamples',
  'computeIsocline',
  'computeLyapunovExponents',
  'computeCovariantLyapunovVectors',
  'solveEquilibrium',
  'solveForcedPeriodicResponse',
  'runForcedPeriodicResponseContinuation',
  'runEquilibriumContinuation',
  'runContinuationExtension',
  'runEquilibriumManifold1D',
  'runEquilibriumManifold1DExtension',
  'runEquilibriumManifold1DGroupExtension',
  'runManifold2DExtension',
  'runEquilibriumManifold2D',
  'runLimitCycleManifold2D',
  'computeLimitCycleFloquetModes',
  'computeNormalForm',
  'runPeriodicBranchPointSwitch',
  'runFoldCurveContinuation',
  'runHopfCurveContinuation',
  'runCodim2BranchSwitch',
  'runIsoperiodicCurveContinuation',
  'runLimitCycleCodim1CurveContinuation',
  'runLimitCycleContinuationFromHopf',
  'runLimitCycleContinuationFromOrbit',
  'runLimitCycleContinuationFromPD',
  'runHomoclinicFromLargeCycle',
  'runHomoclinicFromHomoclinic',
  'runHomotopySaddleFromEquilibrium',
  'runHomoclinicFromHomotopySaddle',
  'runHeteroclinicFromOrbit',
  'runMapCycleContinuationFromPD',
  'validateSystem',
] as const satisfies readonly ComputeOperationKind[]

const expectedProgressOperationKinds = [
  'runForcedPeriodicResponseContinuation',
  'runEquilibriumContinuation',
  'runContinuationExtension',
  'runEquilibriumManifold1D',
  'runEquilibriumManifold1DExtension',
  'runEquilibriumManifold1DGroupExtension',
  'runManifold2DExtension',
  'runEquilibriumManifold2D',
  'runLimitCycleManifold2D',
  'runPeriodicBranchPointSwitch',
  'runFoldCurveContinuation',
  'runHopfCurveContinuation',
  'runCodim2BranchSwitch',
  'runIsoperiodicCurveContinuation',
  'runLimitCycleCodim1CurveContinuation',
  'runLimitCycleContinuationFromHopf',
  'runLimitCycleContinuationFromOrbit',
  'runLimitCycleContinuationFromPD',
  'runHomoclinicFromLargeCycle',
  'runHomoclinicFromHomoclinic',
  'runHomotopySaddleFromEquilibrium',
  'runHomoclinicFromHomotopySaddle',
  'runHeteroclinicFromOrbit',
  'runMapCycleContinuationFromPD',
] as const satisfies readonly ProgressOperationKind[]

describe('compute protocol', () => {
  it('enumerates every ForkCoreClient operation exactly once', () => {
    expect(computeOperationKinds).toEqual(expectedOperationKinds)
    expect(new Set(computeOperationKinds).size).toBe(computeOperationKinds.length)
    expect(Object.keys(computeOperationMetadata)).toEqual(expectedOperationKinds)
  })

  it('derives progress support from the client method options', () => {
    expect(progressOperationKinds).toEqual(expectedProgressOperationKinds)
    for (const kind of computeOperationKinds) {
      expect(computeOperationMetadata[kind].reportsProgress).toBe(
        expectedProgressOperationKinds.includes(kind as ProgressOperationKind)
      )
    }
  })

  it('keeps operation request and result types correlated', () => {
    expectTypeOf<ComputeRequest<'simulateOrbit'>>().toEqualTypeOf<SimulateOrbitRequest>()
    expectTypeOf<ComputeResult<'simulateOrbit'>>().toEqualTypeOf<SimulateOrbitResult>()
    expectTypeOf<ComputeRequest<'computeIsocline'>>().toEqualTypeOf<ComputeIsoclineRequest>()
    expectTypeOf<ComputeResult<'computeIsocline'>>().toEqualTypeOf<ComputeIsoclineResult>()
    expectTypeOf<ComputeRequest<'solveEquilibrium'>>().toEqualTypeOf<SolveEquilibriumRequest>()
    expectTypeOf<ComputeResult<'solveEquilibrium'>>().toEqualTypeOf<SolveEquilibriumResult>()
    expectTypeOf<ComputeRequest<'solveForcedPeriodicResponse'>>().toEqualTypeOf<
      SolveForcedPeriodicResponseRequest
    >()
    expectTypeOf<ComputeResult<'solveForcedPeriodicResponse'>>().toEqualTypeOf<
      SolveForcedPeriodicResponseResult
    >()
    expectTypeOf<ComputeRequest<'runForcedPeriodicResponseContinuation'>>().toEqualTypeOf<
      ForcedPeriodicResponseContinuationRequest
    >()
    expectTypeOf<ComputeResult<'runForcedPeriodicResponseContinuation'>>().toEqualTypeOf<
      ForcedPeriodicResponseContinuationResult
    >()
    expectTypeOf<ComputeRequest<'runEquilibriumContinuation'>>().toEqualTypeOf<
      EquilibriumContinuationRequest
    >()
    expectTypeOf<ComputeResult<'runEquilibriumContinuation'>>().toEqualTypeOf<
      EquilibriumContinuationResult
    >()
    expectTypeOf<ContinuationProgress>().toMatchTypeOf<{
      done: boolean
      current_step: number
      max_steps: number
    }>()
  })

  it('constructs a correlated worker request without casts', () => {
    const payload: SolveEquilibriumRequest = {
      system: {
        name: 'Test',
        equations: ['x'],
        params: [],
        paramNames: [],
        varNames: ['x'],
        solver: 'rk4',
        type: 'flow',
      },
      initialGuess: [0],
      maxSteps: 20,
      dampingFactor: 0.5,
    }

    const request = createWorkerRequest('request-1', 'solveEquilibrium', payload)

    expect(request).toEqual({ id: 'request-1', kind: 'solveEquilibrium', payload })
    expectTypeOf(request).toEqualTypeOf<WorkerOperationRequest<'solveEquilibrium'>>()
  })
})
