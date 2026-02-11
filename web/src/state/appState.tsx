import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import type {
  ComputeIsoclineRequest as CoreComputeIsoclineRequest,
  ComputeIsoclineResult,
  ContinuationProgress,
  CovariantLyapunovRequest as CoreCovariantLyapunovRequest,
  CovariantLyapunovResponse,
  ForkCoreClient,
  LyapunovExponentsRequest as CoreLyapunovExponentsRequest,
  SampleMap1DFunctionRequest,
  SampleMap1DFunctionResult,
  ValidateSystemResult,
} from '../compute/ForkCoreClient'
import type { JobTiming } from '../compute/jobQueue'
import { createSystem } from '../system/model'
import type {
  AnalysisObject,
  BifurcationDiagram,
  ContinuationObject,
  ContinuationPoint,
  ContinuationSettings,
  CovariantLyapunovData,
  EquilibriumObject,
  EquilibriumSolverParams,
  FrozenVariablesConfig,
  IsoclineAxis,
  IsoclineObject,
  IsoclineSource,
  LimitCycleRenderTarget,
  LimitCycleObject,
  OrbitObject,
  ParameterRef,
  System,
  SystemSummary,
  Scene,
  SubsystemSnapshot,
  SystemConfig,
  TreeNode,
} from '../system/types'
import type { SystemStore } from '../system/store'
import {
  addBifurcationDiagram,
  addBranch,
  addObject,
  addScene,
  moveNode,
  reorderNode,
  removeNode,
  renameNode,
  selectNode,
  toggleNodeExpanded,
  toggleNodeVisibility,
  updateBifurcationDiagram,
  updateLimitCycleRenderTarget,
  updateLayout,
  updateViewportHeights,
  updateNodeRender,
  updateObject,
  updateBranch,
  updateScene,
  updateSystem,
} from '../system/model'
import {
  ensureHomoclinicEndpointResumeSeeds,
  ensureBranchIndices,
  extractHopfOmega,
  getBranchParams,
  normalizeEigenvalueArray,
  normalizeBranchEigenvalues,
  trimHomoclinicLargeCycleSeedPoint,
  resolveContinuationPointParam2Value,
  serializeBranchDataForWasm,
} from '../system/continuation'
import { resolveObjectParams } from '../system/parameters'
import {
  buildReducedRunConfig,
  buildSubsystemSnapshot,
  continuationParameterOptions,
  formatParameterRefLabel,
  isSubsystemSnapshotCompatible,
  mapStateRowsToReduced,
  parseParameterRefLabel,
  projectStateToReduced,
  resolveRuntimeParameterName,
  resolveSubsystemSnapshot,
} from '../system/subsystemGateway'
import { downloadSystem, readSystemFile } from '../system/importExport'
import { formatEquilibriumLabel } from '../system/labels'
import { AppContext } from './appContext'
import { validateSystemConfig, validateSystemName } from './systemValidation'
import { isCliSafeName } from '../utils/naming'

function findObjectIdByName(system: System, name: string): string | null {
  const match = Object.entries(system.objects).find(([, obj]) => obj.name === name)
  return match ? match[0] : null
}

function branchNameExists(system: System, parentName: string, name: string): boolean {
  return Object.values(system.branches).some(
    (branch) => branch.parentObject === parentName && branch.name === name
  )
}

function validateBranchName(name: string): string | null {
  if (!name.trim()) return 'Branch name is required.'
  if (!isCliSafeName(name)) {
    return 'Branch names must be alphanumeric with underscores only.'
  }
  return null
}

function validateObjectName(name: string, label: string): string | null {
  if (!name.trim()) return `${label} name is required.`
  if (!isCliSafeName(name)) {
    return `${label} names must be alphanumeric with underscores only.`
  }
  return null
}

function resolveExtensionEndpointArrayIndex(
  branch: ContinuationObject,
  forward: boolean
): { arrayIndex: number; logicalIndex: number } {
  const indices = ensureBranchIndices(branch.data)
  if (indices.length === 0) {
    return { arrayIndex: 0, logicalIndex: 0 }
  }
  let selected = 0
  for (let i = 1; i < indices.length; i += 1) {
    if (forward ? indices[i] > indices[selected] : indices[i] < indices[selected]) {
      selected = i
    }
  }
  return { arrayIndex: selected, logicalIndex: indices[selected] ?? 0 }
}

function resolveHomoclinicSeedState(point: ContinuationPoint, stateDimension: number): number[] {
  const withPacked = point as ContinuationPoint & {
    packedState?: number[]
    packed_state?: number[]
  }
  const packed = withPacked.packedState ?? withPacked.packed_state
  if (Array.isArray(packed) && packed.length > stateDimension) {
    return [...packed]
  }
  return [...point.state]
}

function inferHomoclinicFixedEpsFromPoint(
  pointState: number[],
  ntst: number,
  ncol: number,
  dim: number
): { eps0: number; eps1: number } {
  if (!Number.isInteger(ntst) || !Number.isInteger(ncol) || ntst <= 0 || ncol <= 0 || dim <= 0) {
    return { eps0: 1e-2, eps1: 1e-2 }
  }
  const meshLen = (ntst + 1) * dim
  const stageLen = ntst * ncol * dim
  const x0Start = meshLen + stageLen
  const x0End = x0Start + dim
  if (pointState.length < x0End || meshLen < dim) {
    return { eps0: 1e-2, eps1: 1e-2 }
  }
  const first = pointState.slice(0, dim)
  const last = pointState.slice(meshLen - dim, meshLen)
  const x0 = pointState.slice(x0Start, x0End)
  const dist = (a: number[], b: number[]) =>
    Math.sqrt(a.reduce((acc, value, index) => acc + (value - (b[index] ?? 0)) ** 2, 0))
  return {
    eps0: Math.max(1e-8, dist(first, x0)),
    eps1: Math.max(1e-8, dist(last, x0)),
  }
}

function getNodeLabel(node: TreeNode | undefined, systemType: SystemConfig['type']): string {
  if (!node) return 'Item'
  if (node.kind === 'branch') return 'Branch'
  if (node.kind === 'scene') return 'Scene'
  if (node.kind === 'diagram') return 'Bifurcation diagram'
  if (node.kind === 'object') {
    if (node.objectType === 'orbit') return 'Orbit'
    if (node.objectType === 'equilibrium') return formatEquilibriumLabel(systemType)
    if (node.objectType === 'limit_cycle') return 'Limit cycle'
    if (node.objectType === 'isocline') return 'Isocline'
    return 'Object'
  }
  return 'Item'
}

function reshapeCovariantVectors(
  payload: CovariantLyapunovResponse
): CovariantLyapunovData {
  const { dimension, checkpoints, vectors, times } = payload
  if (dimension <= 0) {
    throw new Error('Invalid dimension for covariant Lyapunov vectors.')
  }
  if (checkpoints <= 0) {
    throw new Error('No checkpoints returned for covariant Lyapunov vectors.')
  }
  const expected = dimension * dimension * checkpoints
  if (vectors.length < expected) {
    throw new Error('Covariant Lyapunov payload is incomplete.')
  }

  const shaped: number[][][] = []
  for (let step = 0; step < checkpoints; step += 1) {
    const base = step * dimension * dimension
    const stepVectors: number[][] = []
    for (let vecIdx = 0; vecIdx < dimension; vecIdx += 1) {
      const vec: number[] = []
      for (let component = 0; component < dimension; component += 1) {
        const index = base + component * dimension + vecIdx
        vec.push(vectors[index])
      }
      stepVectors.push(vec)
    }
    shaped.push(stepVectors)
  }

  return {
    dim: dimension,
    times: times.slice(0, checkpoints),
    vectors: shaped,
  }
}

function requireOrbitRunConfig(
  system: SystemConfig,
  orbit: OrbitObject
): { snapshot: SubsystemSnapshot; runConfig: SystemConfig } {
  if (!orbit.parameters || orbit.parameters.length !== system.params.length) {
    throw new Error(
      'Orbit parameters are unavailable. Run the orbit again to compute Lyapunov data.'
    )
  }
  const snapshot = resolveSubsystemSnapshot(
    system,
    orbit.subsystemSnapshot,
    orbit.frozenVariables
  )
  return {
    snapshot,
    runConfig: buildReducedRunConfig(system, snapshot, [...orbit.parameters]),
  }
}

function defaultIsoclineSource(system: SystemConfig): IsoclineSource {
  const firstVariable = system.varNames[0] ?? 'x'
  if (system.type === 'map') {
    return { kind: 'map_increment', variableName: firstVariable }
  }
  return { kind: 'flow_derivative', variableName: firstVariable }
}

function defaultIsoclineSamples(activeCount: number): number {
  if (activeCount <= 1) return 256
  if (activeCount === 2) return 96
  return 40
}

function defaultIsoclineAxes(system: SystemConfig): IsoclineAxis[] {
  const maxAxes = Math.min(system.varNames.length, 3)
  const count = maxAxes
  const sampleCount = defaultIsoclineSamples(count)
  return system.varNames.slice(0, count).map((variableName) => ({
    variableName,
    min: -2,
    max: 2,
    samples: sampleCount,
  }))
}

function normalizeIsoclineAxes(system: SystemConfig, axes: IsoclineAxis[]): IsoclineAxis[] {
  const varSet = new Set(system.varNames)
  const unique: IsoclineAxis[] = []
  const used = new Set<string>()
  for (const axis of axes) {
    if (!varSet.has(axis.variableName)) continue
    if (used.has(axis.variableName)) continue
    used.add(axis.variableName)
    unique.push({
      variableName: axis.variableName,
      min: Number.isFinite(axis.min) ? axis.min : -2,
      max: Number.isFinite(axis.max) ? axis.max : 2,
      samples:
        Number.isFinite(axis.samples)
          ? Math.trunc(axis.samples)
          : defaultIsoclineSamples(axes.length),
    })
    if (unique.length === 3) break
  }
  if (unique.length > 0) return unique
  return defaultIsoclineAxes(system)
}

function normalizeIsoclineFrozenState(system: SystemConfig, frozenState: number[]): number[] {
  return system.varNames.map((_, index) => {
    const value = frozenState[index]
    return Number.isFinite(value) ? value : 0
  })
}

function resolveIsoclineExpression(system: SystemConfig, source: IsoclineSource): string {
  if (source.kind === 'custom') return source.expression
  const varIndex = system.varNames.indexOf(source.variableName)
  if (varIndex < 0 || varIndex >= system.equations.length) {
    throw new Error(`Unknown state variable "${source.variableName}" for isocline expression.`)
  }
  if (source.kind === 'flow_derivative') {
    return system.equations[varIndex]
  }
  return `(${system.equations[varIndex]}) - (${source.variableName})`
}

function normalizeIsoclineSource(system: SystemConfig, source: IsoclineSource): IsoclineSource {
  if (source.kind === 'custom') {
    return {
      kind: 'custom',
      expression: source.expression,
    }
  }
  const fallback = system.varNames[0] ?? 'x'
  const safeVariable = system.varNames.includes(source.variableName)
    ? source.variableName
    : fallback
  if (system.type === 'map') {
    return source.kind === 'map_increment'
      ? { kind: 'map_increment', variableName: safeVariable }
      : { kind: 'map_increment', variableName: safeVariable }
  }
  return source.kind === 'flow_derivative'
    ? { kind: 'flow_derivative', variableName: safeVariable }
    : { kind: 'flow_derivative', variableName: safeVariable }
}

function buildCurrentIsoclineComputeRequest(
  system: SystemConfig,
  object: IsoclineObject
): {
  request: CoreComputeIsoclineRequest
  snapshot: NonNullable<IsoclineObject['lastComputed']>
} {
  const source = normalizeIsoclineSource(system, object.source)
  const axes = normalizeIsoclineAxes(system, object.axes)
  const frozenState = normalizeIsoclineFrozenState(system, object.frozenState)
  const subsystemSnapshot = buildObjectSubsystemSnapshot(system, object)
  const expression = resolveIsoclineExpression(system, source).trim()
  if (!expression) {
    throw new Error('Isocline expression is required before computing.')
  }
  const runConfig: SystemConfig = {
    ...system,
    params: resolveObjectParams(system, object.customParameters),
  }
  const request: CoreComputeIsoclineRequest = {
    system: runConfig,
    expression,
    level: object.level,
    axes,
    frozenState,
  }
  const snapshot: NonNullable<IsoclineObject['lastComputed']> = {
    source,
    expression,
    level: object.level,
    axes,
    frozenState,
    parameters: [...runConfig.params],
    computedAt: new Date().toISOString(),
    subsystemSnapshot,
  }
  return { request, snapshot }
}

function buildLastIsoclineComputeRequest(
  system: SystemConfig,
  object: IsoclineObject
): {
  request: CoreComputeIsoclineRequest
  snapshot: NonNullable<IsoclineObject['lastComputed']>
} {
  const snapshot = object.lastComputed
  if (!snapshot) {
    throw new Error('No previously computed isocline settings are available.')
  }
  const params =
    Array.isArray(snapshot.parameters) && snapshot.parameters.length === system.params.length
      ? snapshot.parameters
      : system.params
  const runConfig: SystemConfig = {
    ...system,
    params: [...params],
  }
  const request: CoreComputeIsoclineRequest = {
    system: runConfig,
    expression: snapshot.expression,
    level: snapshot.level,
    axes: snapshot.axes,
    frozenState: snapshot.frozenState,
  }
  return {
    request,
    snapshot: {
      ...snapshot,
      subsystemSnapshot: resolveSubsystemSnapshot(
        system,
        snapshot.subsystemSnapshot,
        normalizeObjectFrozenVariables(system, object),
        { maxFreeVariables: 3 }
      ),
    },
  }
}

function buildIsoclineSnapshotSignature(
  snapshot: NonNullable<IsoclineObject['lastComputed']>
): string {
  return JSON.stringify({
    source: snapshot.source,
    expression: snapshot.expression,
    level: snapshot.level,
    axes: snapshot.axes,
    frozenState: snapshot.frozenState,
    parameters: snapshot.parameters,
  })
}

type FreezableAnalysisObject = OrbitObject | EquilibriumObject | LimitCycleObject | IsoclineObject

function isFreezableObject(object: AnalysisObject | undefined): object is FreezableAnalysisObject {
  if (!object) return false
  return (
    object.type === 'orbit' ||
    object.type === 'equilibrium' ||
    object.type === 'limit_cycle' ||
    object.type === 'isocline'
  )
}

function normalizeObjectFrozenVariables(
  system: SystemConfig,
  object: FreezableAnalysisObject
): FrozenVariablesConfig {
  if (object.type === 'isocline') {
    const frozenValuesByVarName: Record<string, number> = {}
    const freeSet = new Set(object.axes.map((axis) => axis.variableName))
    system.varNames.forEach((name, index) => {
      if (freeSet.has(name)) return
      frozenValuesByVarName[name] = object.frozenState[index] ?? 0
    })
    return { frozenValuesByVarName }
  }
  return object.frozenVariables ?? { frozenValuesByVarName: {} }
}

function buildObjectSubsystemSnapshot(
  system: SystemConfig,
  object: FreezableAnalysisObject,
  options?: { useStoredSnapshot?: boolean }
): SubsystemSnapshot {
  const maxFree = object.type === 'isocline' ? 3 : undefined
  if (
    options?.useStoredSnapshot &&
    object.subsystemSnapshot &&
    isSubsystemSnapshotCompatible(system, object.subsystemSnapshot)
  ) {
    return object.subsystemSnapshot
  }
  return buildSubsystemSnapshot(system, normalizeObjectFrozenVariables(system, object), {
    maxFreeVariables: maxFree,
  })
}

function buildBranchSubsystemSnapshot(
  system: SystemConfig,
  branch: ContinuationObject,
  sourceObject?: FreezableAnalysisObject | null
): SubsystemSnapshot {
  if (branch.subsystemSnapshot && isSubsystemSnapshotCompatible(system, branch.subsystemSnapshot)) {
    return branch.subsystemSnapshot
  }
  if (sourceObject) {
    return buildObjectSubsystemSnapshot(system, sourceObject, { useStoredSnapshot: true })
  }
  return buildSubsystemSnapshot(system)
}

function resolveDisplayParameterName(ref: ParameterRef): string {
  return formatParameterRefLabel(ref)
}

function parseContinuationParameter(
  system: SystemConfig,
  snapshot: SubsystemSnapshot,
  label: string
): ParameterRef {
  return parseParameterRefLabel(system, snapshot, label)
}

function parseContinuationParameterAllowRuntimeName(
  system: SystemConfig,
  snapshot: SubsystemSnapshot,
  label: string
): ParameterRef {
  try {
    return parseContinuationParameter(system, snapshot, label)
  } catch (error) {
    for (const [variableName, generatedName] of Object.entries(
      snapshot.frozenParameterNamesByVarName
    )) {
      if (generatedName === label) {
        return { kind: 'frozen_var', variableName }
      }
    }
    throw error
  }
}

function isTwoParameterBranchType(
  branchType: ContinuationObject['data']['branch_type'] | undefined | null
): branchType is Extract<
  NonNullable<ContinuationObject['data']['branch_type']>,
  { param1_name: string; param2_name: string }
> {
  return Boolean(
    branchType &&
      typeof branchType === 'object' &&
      'param1_name' in branchType &&
      'param2_name' in branchType
  )
}

function resolveBranchParam2Ref(
  branch: ContinuationObject
): ContinuationObject['parameter2Ref'] | undefined {
  const branchType = branch.data.branch_type
  if (
    branchType &&
    typeof branchType === 'object' &&
    'param2_ref' in branchType &&
    branchType.param2_ref
  ) {
    return branchType.param2_ref
  }
  return branch.parameter2Ref
}

function restoreExtendedBranchMetadata(
  system: SystemConfig,
  snapshot: SubsystemSnapshot,
  sourceBranch: ContinuationObject,
  data: ContinuationObject['data']
): ContinuationObject['data'] {
  const sourceType = sourceBranch.data.branch_type
  if (!data.branch_type && sourceType) {
    return {
      ...data,
      branch_type: sourceType,
    }
  }
  if (!isTwoParameterBranchType(data.branch_type)) {
    return data
  }

  const incomingType = data.branch_type
  const sourceTwoParamType = isTwoParameterBranchType(sourceType) ? sourceType : null
  const tryParseRef = (label: string | undefined): ParameterRef | null => {
    if (!label) return null
    try {
      return parseContinuationParameterAllowRuntimeName(system, snapshot, label)
    } catch {
      return null
    }
  }

  const param1Ref =
    incomingType.param1_ref ??
    sourceTwoParamType?.param1_ref ??
    sourceBranch.parameterRef ??
    tryParseRef(sourceTwoParamType?.param1_name) ??
    tryParseRef(incomingType.param1_name)
  const param2Ref =
    incomingType.param2_ref ??
    sourceTwoParamType?.param2_ref ??
    sourceBranch.parameter2Ref ??
    tryParseRef(sourceTwoParamType?.param2_name) ??
    tryParseRef(incomingType.param2_name)

  const param1Name = param1Ref
    ? resolveDisplayParameterName(param1Ref)
    : (sourceTwoParamType?.param1_name ?? incomingType.param1_name)
  const param2Name = param2Ref
    ? resolveDisplayParameterName(param2Ref)
    : (sourceTwoParamType?.param2_name ?? incomingType.param2_name)

  return {
    ...data,
    branch_type: {
      ...incomingType,
      param1_name: param1Name,
      param2_name: param2Name,
      param1_ref: param1Ref ?? undefined,
      param2_ref: param2Ref ?? undefined,
    },
  }
}

function serializeBranchDataForExtension(
  system: SystemConfig,
  snapshot: SubsystemSnapshot,
  branch: ContinuationObject,
  dataOverride?: ContinuationObject['data']
) {
  const data = dataOverride ?? branch.data
  const branchType = data.branch_type
  if (isTwoParameterBranchType(branchType)) {
    const param1Ref =
      branchType.param1_ref ??
      branch.parameterRef ??
      parseContinuationParameterAllowRuntimeName(system, snapshot, branchType.param1_name)
    const param2Ref =
      branchType.param2_ref ??
      resolveBranchParam2Ref(branch) ??
      parseContinuationParameterAllowRuntimeName(system, snapshot, branchType.param2_name)
    const runtimeBranchType = {
      ...branchType,
      param1_name: resolveRuntimeParameterName(snapshot, param1Ref),
      param2_name: resolveRuntimeParameterName(snapshot, param2Ref),
      param1_ref: param1Ref,
      param2_ref: param2Ref,
    }
    return serializeBranchDataForWasm({
      ...branch,
      data: {
        ...data,
        branch_type: runtimeBranchType,
      },
    })
  }
  return serializeBranchDataForWasm({
    ...branch,
    data,
  })
}

function resolveBranchPointReducedParamOverrides(
  branch: ContinuationObject,
  point: ContinuationPoint
): Partial<Record<string, number>> {
  const valuesByGeneratedName: Partial<Record<string, number>> = {}
  const snapshot = branch.subsystemSnapshot
  if (!snapshot) return valuesByGeneratedName
  if (branch.parameterRef?.kind === 'frozen_var' && Number.isFinite(point.param_value)) {
    const generated = snapshot.frozenParameterNamesByVarName[branch.parameterRef.variableName]
    if (generated) {
      valuesByGeneratedName[generated] = point.param_value
    }
  }
  const branchType = branch.data.branch_type
  const param2Ref = resolveBranchParam2Ref(branch)
  if (param2Ref?.kind === 'frozen_var') {
    const value = Number.isFinite(point.param2_value)
      ? point.param2_value
      : resolveContinuationPointParam2Value(
          point,
          branchType,
          snapshot.freeVariableNames.length
        )
    if (Number.isFinite(value)) {
      const generated = snapshot.frozenParameterNamesByVarName[param2Ref.variableName]
      if (generated) {
        valuesByGeneratedName[generated] = value
      }
    }
  }
  return valuesByGeneratedName
}

function applyReducedParamOverrides(
  runConfig: SystemConfig,
  overrides: Partial<Record<string, number>>
): SystemConfig {
  if (!overrides || Object.keys(overrides).length === 0) return runConfig
  const next = {
    ...runConfig,
    params: [...runConfig.params],
  }
  for (let index = 0; index < runConfig.paramNames.length; index += 1) {
    const name = runConfig.paramNames[index]
    if (!Object.prototype.hasOwnProperty.call(overrides, name)) continue
    const value = overrides[name]
    if (!Number.isFinite(value)) continue
    next.params[index] = value as number
  }
  return next
}

function projectStateForSnapshot(
  snapshot: SubsystemSnapshot,
  state: number[],
  label: string
): number[] {
  const freeDimension = snapshot.freeVariableNames.length
  const baseDimension = snapshot.baseVarNames.length
  if (state.length === freeDimension) {
    return [...state]
  }
  if (freeDimension === baseDimension) {
    return [...state]
  }
  if (state.length === baseDimension) {
    return projectStateToReduced(snapshot, state)
  }
  throw new Error(`${label} dimension mismatch for the selected frozen-variable subsystem.`)
}

type ObjectSubsystemRun = {
  snapshot: SubsystemSnapshot
  runConfig: SystemConfig
}

function buildObjectSubsystemRunConfig(
  system: SystemConfig,
  object: FreezableAnalysisObject,
  baseParams: number[]
): ObjectSubsystemRun {
  const snapshot = buildObjectSubsystemSnapshot(system, object)
  return {
    snapshot,
    runConfig: buildReducedRunConfig(system, snapshot, baseParams),
  }
}

export type ContinuationProgressState = {
  label: string
  progress: ContinuationProgress
}

export type OrbitRunRequest = {
  orbitId: string
  initialState: number[]
  duration: number
  dt?: number
}

export type OrbitLyapunovRequest = {
  orbitId: string
  transient: number
  qrStride: number
}

export type OrbitCovariantLyapunovRequest = {
  orbitId: string
  transient: number
  forward: number
  backward: number
  qrStride: number
}

export type EquilibriumSolveRequest = {
  equilibriumId: string
  initialGuess: number[]
  maxSteps: number
  dampingFactor: number
  mapIterations?: number
}

export type EquilibriumContinuationRequest = {
  equilibriumId: string
  name: string
  parameterName: string
  mapIterations?: number
  settings: ContinuationSettings
  forward: boolean
}

export type BranchContinuationRequest = {
  branchId: string
  pointIndex: number
  name: string
  parameterName: string
  settings: ContinuationSettings
  forward: boolean
}

export type BranchExtensionRequest = {
  branchId: string
  settings: ContinuationSettings
  forward: boolean
}

export type FoldCurveContinuationRequest = {
  branchId: string
  pointIndex: number
  name: string
  param2Name: string
  settings: ContinuationSettings
  forward: boolean
}

export type HopfCurveContinuationRequest = {
  branchId: string
  pointIndex: number
  name: string
  param2Name: string
  settings: ContinuationSettings
  forward: boolean
}

export type IsochroneCurveContinuationRequest = {
  branchId: string
  pointIndex: number
  name: string
  parameterName: string
  param2Name: string
  settings: ContinuationSettings
  forward: boolean
}

export type MapNSCurveContinuationRequest = {
  branchId: string
  pointIndex: number
  name: string
  param2Name: string
  settings: ContinuationSettings
  forward: boolean
}

export type LimitCycleOrbitContinuationRequest = {
  orbitId: string
  limitCycleName: string
  branchName: string
  parameterName: string
  tolerance: number
  ntst: number
  ncol: number
  settings: ContinuationSettings
  forward: boolean
}

export type MapCyclePDContinuationRequest = {
  branchId: string
  pointIndex: number
  cycleName: string
  branchName: string
  amplitude: number
  settings: ContinuationSettings
  forward: boolean
  solverParams: {
    maxSteps: number
    dampingFactor: number
    mapIterations?: number
  }
}

export type LimitCyclePDContinuationRequest = {
  branchId: string
  pointIndex: number
  limitCycleName: string
  branchName: string
  amplitude: number
  ncol: number
  settings: ContinuationSettings
  forward: boolean
}

export type HomoclinicFromLargeCycleRequest = {
  branchId: string
  pointIndex: number
  name: string
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
  branchId: string
  pointIndex: number
  name: string
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
  branchId: string
  pointIndex: number
  name: string
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
  branchId: string
  pointIndex: number
  name: string
  targetNtst: number
  targetNcol: number
  freeTime: boolean
  freeEps0: boolean
  freeEps1: boolean
  settings: ContinuationSettings
  forward: boolean
}

export type IsoclineComputeRequest = {
  isoclineId: string
  useLastComputedSettings?: boolean
}

export type LimitCycleHopfContinuationRequest = {
  branchId: string
  pointIndex: number
  parameterName: string
  limitCycleName: string
  branchName: string
  amplitude: number
  ntst: number
  ncol: number
  settings: ContinuationSettings
  forward: boolean
}


type AppState = {
  system: System | null
  systems: SystemSummary[]
  busy: boolean
  error: string | null
  timings: JobTiming[]
  continuationProgress: ContinuationProgressState | null
  isoclineGeometryCache: Record<
    string,
    {
      signature: string
      geometry: ComputeIsoclineResult
    }
  >
}

type AppAction =
  | { type: 'SET_SYSTEM'; system: System | null }
  | { type: 'SET_SYSTEMS'; systems: SystemSummary[] }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'ADD_TIMING'; timing: JobTiming }
  | { type: 'SET_CONTINUATION_PROGRESS'; progress: ContinuationProgressState | null }
  | {
      type: 'SET_ISOCLINE_GEOMETRY'
      isoclineId: string
      signature: string
      geometry: ComputeIsoclineResult
    }
  | { type: 'REMOVE_ISOCLINE_GEOMETRY'; isoclineId: string }

const initialState: AppState = {
  system: null,
  systems: [],
  busy: false,
  error: null,
  timings: [],
  continuationProgress: null,
  isoclineGeometryCache: {},
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_SYSTEM':
      return {
        ...state,
        system: action.system,
        isoclineGeometryCache:
          state.system && action.system && state.system.id === action.system.id
            ? state.isoclineGeometryCache
            : {},
      }
    case 'SET_SYSTEMS':
      return { ...state, systems: action.systems }
    case 'SET_BUSY':
      return { ...state, busy: action.busy }
    case 'SET_ERROR':
      return { ...state, error: action.error }
    case 'ADD_TIMING':
      return { ...state, timings: [action.timing, ...state.timings].slice(0, 100) }
    case 'SET_CONTINUATION_PROGRESS':
      return { ...state, continuationProgress: action.progress }
    case 'SET_ISOCLINE_GEOMETRY':
      return {
        ...state,
        isoclineGeometryCache: {
          ...state.isoclineGeometryCache,
          [action.isoclineId]: {
            signature: action.signature,
            geometry: action.geometry,
          },
        },
      }
    case 'REMOVE_ISOCLINE_GEOMETRY': {
      if (!(action.isoclineId in state.isoclineGeometryCache)) return state
      const nextCache = { ...state.isoclineGeometryCache }
      delete nextCache[action.isoclineId]
      return {
        ...state,
        isoclineGeometryCache: nextCache,
      }
    }
    default:
      return state
  }
}

type AppActions = {
  refreshSystems: () => Promise<void>
  createSystem: (name: string) => Promise<void>
  openSystem: (id: string) => Promise<void>
  saveSystem: () => Promise<void>
  exportSystem: (id: string) => Promise<void>
  deleteSystem: (id: string) => Promise<void>
  resetFork: () => Promise<void>
  updateSystem: (system: SystemConfig) => Promise<void>
  validateSystem: (
    system: SystemConfig,
    opts?: { signal?: AbortSignal }
  ) => Promise<ValidateSystemResult>
  selectNode: (nodeId: string | null) => void
  renameNode: (nodeId: string, name: string) => void
  toggleVisibility: (nodeId: string) => void
  toggleExpanded: (nodeId: string) => void
  moveNode: (nodeId: string, direction: 'up' | 'down') => void
  reorderNode: (nodeId: string, targetId: string) => void
  updateLayout: (layout: Partial<System['ui']['layout']>) => void
  updateViewportHeight: (nodeId: string, height: number) => void
  updateRender: (nodeId: string, render: Partial<TreeNode['render']>) => void
  updateObjectParams: (nodeId: string, params: number[] | null) => void
  updateObjectFrozenVariables: (
    nodeId: string,
    frozenValuesByVarName: Record<string, number>
  ) => void
  updateIsoclineObject: (
    nodeId: string,
    update: Partial<Omit<IsoclineObject, 'type' | 'name' | 'systemName'>>
  ) => void
  updateScene: (sceneId: string, update: Partial<Omit<Scene, 'id' | 'name'>>) => void
  updateBifurcationDiagram: (
    diagramId: string,
    update: Partial<Omit<BifurcationDiagram, 'id' | 'name'>>
  ) => void
  setLimitCycleRenderTarget: (
    objectId: string,
    target: LimitCycleRenderTarget | null
  ) => void
  deleteNode: (nodeId: string) => Promise<void>
  createOrbitObject: (name: string) => Promise<string | null>
  createEquilibriumObject: (name: string) => Promise<string | null>
  createIsoclineObject: (name: string) => Promise<string | null>
  runOrbit: (request: OrbitRunRequest) => Promise<void>
  computeIsocline: (
    request: IsoclineComputeRequest,
    opts?: { signal?: AbortSignal; silent?: boolean }
  ) => Promise<ComputeIsoclineResult | null>
  sampleMap1DFunction: (
    request: SampleMap1DFunctionRequest,
    opts?: { signal?: AbortSignal }
  ) => Promise<SampleMap1DFunctionResult>
  computeLyapunovExponents: (request: OrbitLyapunovRequest) => Promise<void>
  computeCovariantLyapunovVectors: (request: OrbitCovariantLyapunovRequest) => Promise<void>
  solveEquilibrium: (request: EquilibriumSolveRequest) => Promise<void>
  createEquilibriumBranch: (request: EquilibriumContinuationRequest) => Promise<void>
  createBranchFromPoint: (request: BranchContinuationRequest) => Promise<void>
  extendBranch: (request: BranchExtensionRequest) => Promise<void>
  createFoldCurveFromPoint: (request: FoldCurveContinuationRequest) => Promise<void>
  createHopfCurveFromPoint: (request: HopfCurveContinuationRequest) => Promise<void>
  createIsochroneCurveFromPoint: (request: IsochroneCurveContinuationRequest) => Promise<void>
  createNSCurveFromPoint: (request: MapNSCurveContinuationRequest) => Promise<void>
  createLimitCycleFromOrbit: (request: LimitCycleOrbitContinuationRequest) => Promise<void>
  createLimitCycleFromHopf: (request: LimitCycleHopfContinuationRequest) => Promise<void>
  createCycleFromPD: (request: MapCyclePDContinuationRequest) => Promise<void>
  createLimitCycleFromPD: (request: LimitCyclePDContinuationRequest) => Promise<void>
  createHomoclinicFromLargeCycle: (request: HomoclinicFromLargeCycleRequest) => Promise<void>
  createHomoclinicFromHomoclinic: (request: HomoclinicFromHomoclinicRequest) => Promise<void>
  createHomotopySaddleFromEquilibrium: (
    request: HomotopySaddleFromEquilibriumRequest
  ) => Promise<void>
  createHomoclinicFromHomotopySaddle: (
    request: HomoclinicFromHomotopySaddleRequest
  ) => Promise<void>
  addScene: (name: string, targetId?: string | null) => Promise<void>
  addBifurcationDiagram: (name: string, targetId?: string | null) => Promise<void>
  importSystem: (file: File) => Promise<void>
  clearError: () => void
}

export type AppContextValue = {
  state: AppState
  actions: AppActions
}

export function AppProvider({
  store,
  client,
  initialSystem,
  initialSystems,
  initialError,
  children,
}: {
  store: SystemStore
  client: ForkCoreClient
  initialSystem?: System | null
  initialSystems?: SystemSummary[]
  initialError?: string | null
  children: React.ReactNode
}) {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    system: initialSystem ?? initialState.system,
    systems: initialSystems ?? initialState.systems,
    error: initialError ?? initialState.error,
  })

  const uiSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const systemSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestSystemRef = useRef<System | null>(null)
  const isoclineWarmupSystemIdRef = useRef<string | null>(null)
  const isoclineWarmupControllersRef = useRef(new Map<string, AbortController>())

  useEffect(() => {
    latestSystemRef.current = state.system
  }, [state.system])

  useEffect(() => {
    const warmupControllers = isoclineWarmupControllersRef.current
    return () => {
      if (uiSaveTimer.current) clearTimeout(uiSaveTimer.current)
      if (systemSaveTimer.current) clearTimeout(systemSaveTimer.current)
      for (const controller of warmupControllers.values()) {
        controller.abort()
      }
      warmupControllers.clear()
      isoclineWarmupSystemIdRef.current = null
    }
  }, [])

  const scheduleUiSave = useCallback(
    (nextSystem: System) => {
      latestSystemRef.current = nextSystem
      if (uiSaveTimer.current) clearTimeout(uiSaveTimer.current)
      uiSaveTimer.current = setTimeout(async () => {
        uiSaveTimer.current = null
        const latest = latestSystemRef.current
        if (!latest) return
        try {
          await store.saveUi(latest)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          dispatch({ type: 'SET_ERROR', error: message })
        }
      }, 200)
    },
    [store]
  )

  const scheduleSystemSave = useCallback(
    (nextSystem: System) => {
      latestSystemRef.current = nextSystem
      if (systemSaveTimer.current) clearTimeout(systemSaveTimer.current)
      systemSaveTimer.current = setTimeout(async () => {
        systemSaveTimer.current = null
        const latest = latestSystemRef.current
        if (!latest) return
        try {
          await store.save(latest)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          dispatch({ type: 'SET_ERROR', error: message })
        }
      }, 250)
    },
    [store]
  )

  const refreshSystems = useCallback(async () => {
    try {
      const systems = await store.list()
      dispatch({ type: 'SET_SYSTEMS', systems })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'SET_ERROR', error: message })
    }
  }, [store])

  const createSystemAction = useCallback(
    async (name: string) => {
      const nameError = validateSystemName(name)
      if (nameError) {
        dispatch({ type: 'SET_ERROR', error: nameError })
        return
      }
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system = createSystem({ name })
        dispatch({ type: 'SET_SYSTEM', system })
        await store.save(system)
        await refreshSystems()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [refreshSystems, store]
  )

  const openSystem = useCallback(
    async (id: string) => {
      dispatch({ type: 'SET_BUSY', busy: true })
      const system = await store.load(id)
      dispatch({ type: 'SET_SYSTEM', system })
      dispatch({ type: 'SET_BUSY', busy: false })
    },
    [store]
  )

  const saveSystem = useCallback(async () => {
    if (!state.system) return
    dispatch({ type: 'SET_BUSY', busy: true })
    await store.save(state.system)
    await refreshSystems()
    dispatch({ type: 'SET_BUSY', busy: false })
  }, [refreshSystems, state.system, store])

  const exportSystem = useCallback(
    async (id: string) => {
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system =
          state.system && state.system.id === id ? state.system : await store.load(id)
        downloadSystem(system)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const deleteSystem = useCallback(
    async (id: string) => {
      dispatch({ type: 'SET_BUSY', busy: true })
      await store.remove(id)
      await refreshSystems()
      dispatch({ type: 'SET_BUSY', busy: false })
    },
    [refreshSystems, store]
  )

  const resetFork = useCallback(async () => {
    dispatch({ type: 'SET_BUSY', busy: true })
    try {
      await store.clear()
      if (
        typeof window !== 'undefined' &&
        'localStorage' in window &&
        typeof window.localStorage.clear === 'function'
      ) {
        window.localStorage.clear()
      }
      dispatch({ type: 'SET_SYSTEM', system: null })
      dispatch({ type: 'SET_SYSTEMS', systems: [] })
      if (typeof window !== 'undefined') {
        window.location.reload()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'SET_ERROR', error: message })
      dispatch({ type: 'SET_BUSY', busy: false })
    }
  }, [store])

  const updateSystemAction = useCallback(
    async (config: SystemConfig) => {
      if (!state.system) return
      const validation = validateSystemConfig(config)
      if (!validation.valid) {
        dispatch({ type: 'SET_ERROR', error: 'System settings are invalid. Fix errors first.' })
        return
      }
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const nextSystem = updateSystem(state.system, config)
        dispatch({ type: 'SET_SYSTEM', system: nextSystem })
        await store.save(nextSystem)
        await refreshSystems()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [refreshSystems, state.system, store]
  )

  const validateSystemAction = useCallback(
    async (system: SystemConfig, opts?: { signal?: AbortSignal }) => {
      return await client.validateSystem({ system }, opts)
    },
    [client]
  )

  const selectNodeAction = useCallback(
    (nodeId: string | null) => {
      if (!state.system) return
      if (state.system.ui.selectedNodeId === nodeId) return
      const system = selectNode(state.system, nodeId)
      dispatch({ type: 'SET_SYSTEM', system })
    },
    [state.system]
  )

  const renameNodeAction = useCallback(
    (nodeId: string, name: string) => {
      if (!state.system) return
      const trimmedName = name.trim()
      const node = state.system.nodes[nodeId]
      const nameError = validateObjectName(
        trimmedName,
        getNodeLabel(node, state.system.config.type)
      )
      if (nameError) {
        dispatch({ type: 'SET_ERROR', error: nameError })
        return
      }
      const system = renameNode(state.system, nodeId, trimmedName)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleSystemSave(system)
    },
    [scheduleSystemSave, state.system]
  )

  const toggleVisibilityAction = useCallback(
    (nodeId: string) => {
      if (!state.system) return
      const system = toggleNodeVisibility(state.system, nodeId)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const toggleExpandedAction = useCallback(
    (nodeId: string) => {
      if (!state.system) return
      const system = toggleNodeExpanded(state.system, nodeId)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const moveNodeAction = useCallback(
    (nodeId: string, direction: 'up' | 'down') => {
      if (!state.system) return
      const system = moveNode(state.system, nodeId, direction)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const reorderNodeAction = useCallback(
    (nodeId: string, targetId: string) => {
      if (!state.system) return
      const system = reorderNode(state.system, nodeId, targetId)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const updateLayoutAction = useCallback(
    (layout: Partial<System['ui']['layout']>) => {
      if (!state.system) return
      const system = updateLayout(state.system, layout)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const updateViewportHeightAction = useCallback(
    (nodeId: string, height: number) => {
      if (!state.system || !Number.isFinite(height)) return
      const system = updateViewportHeights(state.system, { [nodeId]: height })
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const updateRenderAction = useCallback(
    (nodeId: string, render: Partial<TreeNode['render']>) => {
      if (!state.system) return
      const system = updateNodeRender(state.system, nodeId, render)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const updateObjectParamsAction = useCallback(
    (nodeId: string, params: number[] | null) => {
      if (!state.system) return
      if (params) {
        const expected = state.system.config.params.length
        const hasInvalid =
          params.length !== expected || params.some((value) => !Number.isFinite(value))
        if (hasInvalid) {
          dispatch({ type: 'SET_ERROR', error: 'Parameter override is invalid.' })
          return
        }
      }
      const system = updateObject(state.system, nodeId, {
        customParameters: params ? [...params] : undefined,
      })
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleSystemSave(system)
    },
    [scheduleSystemSave, state.system]
  )

  const updateObjectFrozenVariablesAction = useCallback(
    (nodeId: string, frozenValuesByVarName: Record<string, number>) => {
      if (!state.system) return
      const object = state.system.objects[nodeId]
      if (!isFreezableObject(object)) return

      const normalizedFrozenValuesByVarName: Record<string, number> = {}
      for (const name of state.system.config.varNames) {
        if (!Object.prototype.hasOwnProperty.call(frozenValuesByVarName, name)) continue
        const value = frozenValuesByVarName[name]
        if (!Number.isFinite(value)) {
          dispatch({ type: 'SET_ERROR', error: `Frozen value for "${name}" must be numeric.` })
          return
        }
        normalizedFrozenValuesByVarName[name] = value
      }

      if (object.type === 'isocline') {
        const freeNames = state.system.config.varNames.filter(
          (name) => !Object.prototype.hasOwnProperty.call(normalizedFrozenValuesByVarName, name)
        )
        if (freeNames.length === 0) {
          dispatch({ type: 'SET_ERROR', error: 'At least one free variable is required.' })
          return
        }
        if (freeNames.length > 3) {
          dispatch({
            type: 'SET_ERROR',
            error: 'Isocline computations support at most 3 free variables.',
          })
          return
        }

        const nextAxes = freeNames.map((name) => {
          const existing = object.axes.find((axis) => axis.variableName === name)
          if (existing) return existing
          return {
            variableName: name,
            min: -2,
            max: 2,
            samples: defaultIsoclineSamples(freeNames.length),
          }
        })
        const nextFrozenState = state.system.config.varNames.map((name, index) => {
          if (Object.prototype.hasOwnProperty.call(normalizedFrozenValuesByVarName, name)) {
            return normalizedFrozenValuesByVarName[name]
          }
          return object.frozenState[index] ?? 0
        })
        const updated = updateObject(state.system, nodeId, {
          axes: nextAxes,
          frozenState: nextFrozenState,
          frozenVariables: { frozenValuesByVarName: normalizedFrozenValuesByVarName },
        })
        dispatch({ type: 'SET_SYSTEM', system: updated })
        scheduleSystemSave(updated)
        return
      }

      const updated = updateObject(state.system, nodeId, {
        frozenVariables: { frozenValuesByVarName: normalizedFrozenValuesByVarName },
      })
      dispatch({ type: 'SET_SYSTEM', system: updated })
      scheduleSystemSave(updated)
    },
    [scheduleSystemSave, state.system]
  )

  const updateIsoclineObjectAction = useCallback(
    (
      nodeId: string,
      update: Partial<Omit<IsoclineObject, 'type' | 'name' | 'systemName'>>
    ) => {
      if (!state.system) return
      const object = state.system.objects[nodeId]
      if (!object || object.type !== 'isocline') return
      const source = update.source
        ? normalizeIsoclineSource(state.system.config, update.source)
        : object.source
      const axes = update.axes
        ? normalizeIsoclineAxes(state.system.config, update.axes)
        : object.axes
      const frozenState = update.frozenState
        ? normalizeIsoclineFrozenState(state.system.config, update.frozenState)
        : object.frozenState
      const level =
        typeof update.level === 'number' && Number.isFinite(update.level) ? update.level : object.level
      const freeSet = new Set(axes.map((axis) => axis.variableName))
      const frozenValuesByVarName: Record<string, number> = {}
      state.system.config.varNames.forEach((name, index) => {
        if (freeSet.has(name)) return
        frozenValuesByVarName[name] = frozenState[index] ?? 0
      })
      const merged = {
        ...update,
        source,
        axes,
        frozenState,
        level,
        frozenVariables: { frozenValuesByVarName },
      } as Partial<IsoclineObject>
      const system = updateObject(state.system, nodeId, merged)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleSystemSave(system)
    },
    [scheduleSystemSave, state.system]
  )

  const setLimitCycleRenderTargetAction = useCallback(
    (objectId: string, target: LimitCycleRenderTarget | null) => {
      if (!state.system) return
      const system = updateLimitCycleRenderTarget(state.system, objectId, target)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const updateSceneAction = useCallback(
    (sceneId: string, update: Partial<Omit<Scene, 'id' | 'name'>>) => {
      if (!state.system) return
      const system = updateScene(state.system, sceneId, update)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const updateBifurcationDiagramAction = useCallback(
    (diagramId: string, update: Partial<Omit<BifurcationDiagram, 'id' | 'name'>>) => {
      if (!state.system) return
      const system = updateBifurcationDiagram(state.system, diagramId, update)
      dispatch({ type: 'SET_SYSTEM', system })
      scheduleUiSave(system)
    },
    [scheduleUiSave, state.system]
  )

  const deleteNodeAction = useCallback(
    async (nodeId: string) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system = removeNode(state.system, nodeId)
        dispatch({ type: 'SET_SYSTEM', system })
        dispatch({ type: 'REMOVE_ISOCLINE_GEOMETRY', isoclineId: nodeId })
        await store.save(system)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const createOrbitObject = useCallback(
    async (name: string) => {
      if (!state.system) return null
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        // Create the orbit shell first; simulation runs later from the selection inspector.
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const trimmedName = name.trim()
        const nameError = validateObjectName(trimmedName, 'Orbit')
        if (nameError) {
          throw new Error(nameError)
        }
        const existingNames = Object.values(state.system.objects).map((obj) => obj.name)
        if (existingNames.includes(trimmedName)) {
          throw new Error(`Object "${trimmedName}" already exists.`)
        }

        const dt = system.type === 'map' ? 1 : 0.01
        const obj: OrbitObject = {
          type: 'orbit',
          name: trimmedName,
          systemName: system.name,
          data: [],
          t_start: 0,
          t_end: 0,
          dt,
          parameters: [...system.params],
          frozenVariables: { frozenValuesByVarName: {} },
        }

        const result = addObject(state.system, obj)
        const selected = selectNode(result.system, result.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
        return result.nodeId
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
        return null
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const runOrbit = useCallback(
    async (request: OrbitRunRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const orbit = state.system.objects[request.orbitId]
        if (!orbit || orbit.type !== 'orbit') {
          throw new Error('Select a valid orbit to integrate.')
        }
        if (request.initialState.length !== system.varNames.length) {
          throw new Error('Initial state dimension mismatch.')
        }
        if (request.initialState.some((value) => !Number.isFinite(value))) {
          throw new Error('Initial state values must be numeric.')
        }

        const dt = system.type === 'map' ? 1 : request.dt ?? orbit.dt ?? 0.01
        if (!Number.isFinite(dt) || dt <= 0) {
          throw new Error('Step size must be a positive number.')
        }
        if (!Number.isFinite(request.duration) || request.duration <= 0) {
          throw new Error('Duration must be a positive number.')
        }
        const steps =
          system.type === 'map'
            ? Math.max(1, Math.ceil(request.duration))
            : Math.max(1, Math.ceil(request.duration / dt))

        const baseParams = resolveObjectParams(system, orbit.customParameters)
        const { snapshot, runConfig } = buildObjectSubsystemRunConfig(system, orbit, baseParams)
        const reducedInitialState = projectStateToReduced(snapshot, request.initialState)
        const result = await client.simulateOrbit({
          system: runConfig,
          initialState: reducedInitialState,
          steps,
          dt,
        })

        const updated = updateObject(state.system, request.orbitId, {
          data: result.data,
          t_start: result.t_start,
          t_end: result.t_end,
          dt: result.dt,
          parameters: [...baseParams],
          subsystemSnapshot: snapshot,
          frozenVariables: normalizeObjectFrozenVariables(system, orbit),
        })
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.save(updated)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const sampleMap1DFunction = useCallback(
    async (request: SampleMap1DFunctionRequest, opts?: { signal?: AbortSignal }) => {
      try {
        return await client.sampleMap1DFunction(request, opts)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw err
        }
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
        throw err
      }
    },
    [client]
  )

  const computeIsocline = useCallback(
    async (
      request: IsoclineComputeRequest,
      opts?: { signal?: AbortSignal; silent?: boolean }
    ): Promise<ComputeIsoclineResult | null> => {
      if (!state.system) return null
      const silent = Boolean(opts?.silent)
      if (!silent) {
        dispatch({ type: 'SET_BUSY', busy: true })
      }
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const object = state.system.objects[request.isoclineId]
        if (!object || object.type !== 'isocline') {
          throw new Error('Select a valid isocline object.')
        }

        const payload = request.useLastComputedSettings
          ? buildLastIsoclineComputeRequest(system, object)
          : buildCurrentIsoclineComputeRequest(system, object)
        const result = await client.computeIsocline(payload.request, { signal: opts?.signal })
        const signature = buildIsoclineSnapshotSignature(payload.snapshot)
        dispatch({
          type: 'SET_ISOCLINE_GEOMETRY',
          isoclineId: request.isoclineId,
          signature,
          geometry: result,
        })
        if (!request.useLastComputedSettings) {
          const updated = updateObject(state.system, request.isoclineId, {
            source: payload.snapshot.source,
            level: payload.snapshot.level,
            axes: payload.snapshot.axes,
            frozenState: payload.snapshot.frozenState,
            parameters: payload.snapshot.parameters,
            subsystemSnapshot: payload.snapshot.subsystemSnapshot,
            frozenVariables: normalizeObjectFrozenVariables(system, object),
            lastComputed: payload.snapshot,
          } as Partial<IsoclineObject>)
          dispatch({ type: 'SET_SYSTEM', system: updated })
          await store.save(updated)
        }
        return result
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return null
        }
        const message = err instanceof Error ? err.message : String(err)
        if (!silent) {
          dispatch({ type: 'SET_ERROR', error: message })
          throw err instanceof Error ? err : new Error(message)
        }
        return null
      } finally {
        if (!silent) {
          dispatch({ type: 'SET_BUSY', busy: false })
        }
      }
    },
    [client, state.system, store]
  )

  useEffect(() => {
    const system = state.system
    if (!system) {
      for (const controller of isoclineWarmupControllersRef.current.values()) {
        controller.abort()
      }
      isoclineWarmupControllersRef.current.clear()
      isoclineWarmupSystemIdRef.current = null
      return
    }
    if (isoclineWarmupSystemIdRef.current === system.id) return
    isoclineWarmupSystemIdRef.current = system.id
    for (const controller of isoclineWarmupControllersRef.current.values()) {
      controller.abort()
    }
    isoclineWarmupControllersRef.current.clear()

    for (const [isoclineId, object] of Object.entries(system.objects)) {
      if (object.type !== 'isocline' || !object.lastComputed) continue
      const signature = buildIsoclineSnapshotSignature(object.lastComputed)
      const cached = state.isoclineGeometryCache[isoclineId]
      if (cached && cached.signature === signature) continue
      const controller = new AbortController()
      isoclineWarmupControllersRef.current.set(isoclineId, controller)
      void computeIsocline(
        { isoclineId, useLastComputedSettings: true },
        { signal: controller.signal, silent: true }
      ).finally(() => {
        const current = isoclineWarmupControllersRef.current.get(isoclineId)
        if (current === controller) {
          isoclineWarmupControllersRef.current.delete(isoclineId)
        }
      })
    }
  }, [computeIsocline, state.isoclineGeometryCache, state.system])

  const computeLyapunovExponents = useCallback(
    async (request: OrbitLyapunovRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const orbit = state.system.objects[request.orbitId]
        if (!orbit || orbit.type !== 'orbit') {
          throw new Error('Select a valid orbit to analyze.')
        }
        if (!orbit.data || orbit.data.length < 2) {
          throw new Error('Run an orbit before computing Lyapunov exponents.')
        }
        const { snapshot, runConfig } = requireOrbitRunConfig(system, orbit)

        const duration = orbit.t_end - orbit.t_start
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error('Orbit has no duration to analyze.')
        }

        const dt = orbit.dt || (runConfig.type === 'map' ? 1 : 0.01)
        if (!Number.isFinite(dt) || dt <= 0) {
          throw new Error('Invalid step size detected for this orbit.')
        }

        if (!Number.isFinite(request.transient) || request.transient < 0) {
          throw new Error('Transient time must be non-negative.')
        }
        if (!Number.isFinite(request.qrStride) || request.qrStride <= 0) {
          throw new Error('QR stride must be a positive integer.')
        }

        const transient = Math.min(Math.max(request.transient, 0), duration)
        const targetTime = orbit.t_start + transient

        let startIndex = orbit.data.length - 1
        for (let i = 0; i < orbit.data.length; i += 1) {
          if (orbit.data[i][0] >= targetTime) {
            startIndex = i
            break
          }
        }

        if (startIndex >= orbit.data.length - 1) {
          throw new Error('Transient leaves no data to analyze.')
        }

        const steps = orbit.data.length - startIndex - 1
        const qrStride = Math.max(Math.trunc(request.qrStride), 1)
        const startRowState = orbit.data[startIndex].slice(1)
        const startState =
          startRowState.length === snapshot.freeVariableNames.length
            ? startRowState
            : projectStateForSnapshot(snapshot, startRowState, 'Orbit sample')
        const startTime = orbit.data[startIndex][0]

        const payload: CoreLyapunovExponentsRequest = {
          system: runConfig,
          startState,
          startTime,
          steps,
          dt,
          qrStride,
        }
        const exponents = await client.computeLyapunovExponents(payload)
        const updated = updateObject(state.system, request.orbitId, {
          lyapunovExponents: exponents,
        })
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.save(updated)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const computeCovariantLyapunovVectors = useCallback(
    async (request: OrbitCovariantLyapunovRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const orbit = state.system.objects[request.orbitId]
        if (!orbit || orbit.type !== 'orbit') {
          throw new Error('Select a valid orbit to analyze.')
        }
        if (!orbit.data || orbit.data.length < 2) {
          throw new Error('Run an orbit before computing covariant vectors.')
        }
        const { snapshot, runConfig } = requireOrbitRunConfig(system, orbit)

        const duration = orbit.t_end - orbit.t_start
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error('Orbit has no duration to analyze.')
        }

        const dt = orbit.dt || (runConfig.type === 'map' ? 1 : 0.01)
        if (!Number.isFinite(dt) || dt <= 0) {
          throw new Error('Invalid step size detected for this orbit.')
        }

        if (!Number.isFinite(request.transient) || request.transient < 0) {
          throw new Error('Transient time must be non-negative.')
        }
        if (!Number.isFinite(request.forward) || request.forward < 0) {
          throw new Error('Forward transient must be non-negative.')
        }
        if (!Number.isFinite(request.backward) || request.backward < 0) {
          throw new Error('Backward transient must be non-negative.')
        }
        if (!Number.isFinite(request.qrStride) || request.qrStride <= 0) {
          throw new Error('QR stride must be a positive integer.')
        }

        const transient = Math.min(Math.max(request.transient, 0), duration)
        const totalAvailable = duration - transient
        if (totalAvailable <= 0) {
          throw new Error('Transient leaves no data to analyze.')
        }

        const forwardTime = Math.max(Math.min(request.forward, totalAvailable - dt), 0)
        const backwardTime = Math.max(request.backward, 0)
        const qrStride = Math.max(Math.trunc(request.qrStride), 1)

        if (transient + forwardTime + backwardTime >= duration) {
          throw new Error('Transient windows exceed the trajectory duration.')
        }

        const targetTime = orbit.t_start + transient
        let startIndex = orbit.data.length - 1
        for (let i = 0; i < orbit.data.length; i += 1) {
          if (orbit.data[i][0] >= targetTime) {
            startIndex = i
            break
          }
        }
        if (startIndex >= orbit.data.length - 1) {
          throw new Error('Transient leaves no data to analyze.')
        }

        const stepsAvailable = orbit.data.length - startIndex - 1
        if (stepsAvailable <= 0) {
          throw new Error('Not enough samples beyond the transient point.')
        }

        const forwardSteps = Math.min(
          Math.max(Math.floor(forwardTime / dt), 0),
          Math.max(stepsAvailable - 1, 0)
        )
        if (forwardSteps >= stepsAvailable) {
          throw new Error('Forward transient exceeds available samples.')
        }

        const windowSteps = Math.max(stepsAvailable - forwardSteps, 0)
        if (windowSteps === 0) {
          throw new Error('No samples remain for the analysis window.')
        }

        const backwardSteps = Math.max(Math.floor(backwardTime / dt), 0)
        const startRowState = orbit.data[startIndex].slice(1)
        const startState =
          startRowState.length === snapshot.freeVariableNames.length
            ? startRowState
            : projectStateForSnapshot(snapshot, startRowState, 'Orbit sample')
        const startTime = orbit.data[startIndex][0]

        const payload: CoreCovariantLyapunovRequest = {
          system: runConfig,
          startState,
          startTime,
          windowSteps,
          dt,
          qrStride,
          forwardTransient: forwardSteps,
          backwardTransient: backwardSteps,
        }

        const response = await client.computeCovariantLyapunovVectors(payload)
        const covariantVectors = reshapeCovariantVectors(response)
        const updated = updateObject(state.system, request.orbitId, {
          covariantVectors,
        })
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.save(updated)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createEquilibriumObject = useCallback(
    async (name: string) => {
      if (!state.system) return null
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        // Create the equilibrium shell first; solving runs later from the selection inspector.
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const trimmedName = name.trim()
        const nameError = validateObjectName(
          trimmedName,
          formatEquilibriumLabel(system.type)
        )
        if (nameError) {
          throw new Error(nameError)
        }
        const existingNames = Object.values(state.system.objects).map((obj) => obj.name)
        if (existingNames.includes(trimmedName)) {
          throw new Error(`Object "${trimmedName}" already exists.`)
        }

        const solverParams: EquilibriumSolverParams = {
          initialGuess: system.varNames.map(() => 0),
          maxSteps: 25,
          dampingFactor: 1,
          mapIterations: system.type === 'map' ? 1 : undefined,
        }

        const obj: EquilibriumObject = {
          type: 'equilibrium',
          name: trimmedName,
          systemName: system.name,
          parameters: [...system.params],
          lastSolverParams: solverParams,
          frozenVariables: { frozenValuesByVarName: {} },
        }
        const result = addObject(state.system, obj)
        const selected = selectNode(result.system, result.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
        return result.nodeId
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
        return null
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const createIsoclineObject = useCallback(
    async (name: string) => {
      if (!state.system) return null
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const trimmedName = name.trim()
        const nameError = validateObjectName(trimmedName, 'Isocline')
        if (nameError) {
          throw new Error(nameError)
        }
        const existingNames = Object.values(state.system.objects).map((obj) => obj.name)
        if (existingNames.includes(trimmedName)) {
          throw new Error(`Object "${trimmedName}" already exists.`)
        }
        if (system.varNames.length < 1) {
          throw new Error('Define at least one state variable before creating an isocline.')
        }

        const axes = defaultIsoclineAxes(system)
        const source = defaultIsoclineSource(system)
        const obj: IsoclineObject = {
          type: 'isocline',
          name: trimmedName,
          systemName: system.name,
          source,
          level: 0,
          axes,
          frozenState: system.varNames.map(() => 0),
          parameters: [...system.params],
          frozenVariables: { frozenValuesByVarName: {} },
        }
        const result = addObject(state.system, obj)
        const selected = selectNode(result.system, result.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
        return result.nodeId
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
        return null
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const solveEquilibrium = useCallback(
    async (request: EquilibriumSolveRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      const system = state.system.config
      const equilibriumLabelLower = formatEquilibriumLabel(system.type, { lowercase: true })
      const runSummary = {
        timestamp: new Date().toISOString(),
        success: false,
        residual_norm: undefined as number | undefined,
        iterations: undefined as number | undefined,
      }

      let mapIterations: number | undefined

      try {
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const equilibrium = state.system.objects[request.equilibriumId]
        if (!equilibrium || equilibrium.type !== 'equilibrium') {
          throw new Error(`Select a valid ${equilibriumLabelLower} to solve.`)
        }
        if (request.initialGuess.length !== system.varNames.length) {
          throw new Error('Initial guess dimension mismatch.')
        }
        if (request.initialGuess.some((value) => !Number.isFinite(value))) {
          throw new Error('Initial guess values must be numeric.')
        }
        if (!Number.isFinite(request.maxSteps) || request.maxSteps <= 0) {
          throw new Error('Max steps must be a positive number.')
        }
        if (!Number.isFinite(request.dampingFactor) || request.dampingFactor <= 0) {
          throw new Error('Damping factor must be a positive number.')
        }

        if (system.type === 'map') {
          const iterations =
            request.mapIterations ?? equilibrium.lastSolverParams?.mapIterations ?? 1
          if (
            !Number.isFinite(iterations) ||
            iterations <= 0 ||
            !Number.isInteger(iterations)
          ) {
            throw new Error('Cycle length must be a positive integer.')
          }
          mapIterations = iterations
        }

        const solverParams: EquilibriumSolverParams = {
          initialGuess: request.initialGuess,
          maxSteps: request.maxSteps,
          dampingFactor: request.dampingFactor,
          mapIterations,
        }

        const baseParams = resolveObjectParams(system, equilibrium.customParameters)
        const { snapshot, runConfig } = buildObjectSubsystemRunConfig(
          system,
          equilibrium,
          baseParams
        )
        const reducedInitialGuess = projectStateToReduced(snapshot, solverParams.initialGuess)
        const result = await client.solveEquilibrium({
          system: runConfig,
          initialGuess: reducedInitialGuess,
          maxSteps: solverParams.maxSteps,
          dampingFactor: solverParams.dampingFactor,
          mapIterations: solverParams.mapIterations,
        })

        runSummary.success = true
        runSummary.residual_norm = result.residual_norm
        runSummary.iterations = result.iterations

        const updated = updateObject(state.system, request.equilibriumId, {
          solution: result,
          parameters: [...baseParams],
          lastSolverParams: solverParams,
          lastRun: runSummary,
          subsystemSnapshot: snapshot,
          frozenVariables: normalizeObjectFrozenVariables(system, equilibrium),
        })
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.save(updated)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
        const updated = updateObject(state.system, request.equilibriumId, {
          lastRun: runSummary,
          lastSolverParams: {
            initialGuess: request.initialGuess,
            maxSteps: request.maxSteps,
            dampingFactor: request.dampingFactor,
            mapIterations,
          },
        })
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.save(updated)
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createEquilibriumBranch = useCallback(
    async (request: EquilibriumContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const equilibriumLabel = formatEquilibriumLabel(system.type)
        const equilibriumLabelLower = formatEquilibriumLabel(system.type, { lowercase: true })
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const equilibrium = state.system.objects[request.equilibriumId]
        if (!equilibrium || equilibrium.type !== 'equilibrium') {
          throw new Error(`Select a valid ${equilibriumLabelLower} to continue.`)
        }
        if (!equilibrium.solution) {
          throw new Error(`Solve the ${equilibriumLabelLower} before continuing.`)
        }

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, equilibrium.name, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }

        let mapIterations: number | undefined
        if (system.type === 'map') {
          const iterations =
            request.mapIterations ?? equilibrium.lastSolverParams?.mapIterations ?? 1
          if (
            !Number.isFinite(iterations) ||
            iterations <= 0 ||
            !Number.isInteger(iterations)
          ) {
            throw new Error('Cycle length must be a positive integer.')
          }
          mapIterations = iterations
        }

        const baseParams = resolveObjectParams(system, equilibrium.customParameters)
        const { snapshot, runConfig } = buildObjectSubsystemRunConfig(
          system,
          equilibrium,
          baseParams
        )
        const availableParams = continuationParameterOptions(system, snapshot)
        if (availableParams.length === 0) {
          throw new Error('Subsystem has no continuation parameters available.')
        }
        const parameterRef = parseContinuationParameter(system, snapshot, request.parameterName)
        const runtimeParameterName = resolveRuntimeParameterName(snapshot, parameterRef)
        const reducedEquilibriumState = projectStateForSnapshot(
          snapshot,
          equilibrium.solution.state,
          equilibriumLabel
        )

        const branchData = await client.runEquilibriumContinuation(
          {
            system: runConfig,
            equilibriumState: reducedEquilibriumState,
            parameterName: runtimeParameterName,
            mapIterations,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: `${equilibriumLabel} continuation`, progress },
              }),
          }
        )

        const normalized = normalizeBranchEigenvalues(branchData)
        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: resolveDisplayParameterName(parameterRef),
          parameterRef,
          parentObject: equilibrium.name,
          startObject: equilibrium.name,
          branchType: 'equilibrium',
          data: normalized,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          mapIterations,
          subsystemSnapshot: snapshot,
        }

        const parentNodeId = findObjectIdByName(state.system, equilibrium.name)
        if (!parentNodeId) {
          throw new Error(`Unable to locate the parent ${equilibriumLabelLower} in the tree.`)
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const selected = selectNode(created.system, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createBranchFromPoint = useCallback(
    async (request: BranchContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const equilibriumLabel = formatEquilibriumLabel(system.type)
        const equilibriumLabelLower = formatEquilibriumLabel(system.type, { lowercase: true })
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        const canContinueEquilibrium = sourceBranch.branchType === 'equilibrium'
        const canContinueLimitCycle =
          system.type === 'flow' && sourceBranch.branchType === 'limit_cycle'
        if (!canContinueEquilibrium && !canContinueLimitCycle) {
          const supportedLabel =
            system.type === 'flow'
              ? `${equilibriumLabelLower} or limit cycle`
              : equilibriumLabelLower
          throw new Error(
            `Branch continuation is only available for ${supportedLabel} branches.`
          )
        }

        const point: ContinuationPoint | undefined =
          sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, sourceBranch.parentObject, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }
        const sourceObjectId = findObjectIdByName(state.system, sourceBranch.parentObject)
        const sourceObjectCandidate = sourceObjectId ? state.system.objects[sourceObjectId] : undefined
        const sourceObject = isFreezableObject(sourceObjectCandidate) ? sourceObjectCandidate : null
        const snapshot = buildBranchSubsystemSnapshot(system, sourceBranch, sourceObject)
        const availableParams = continuationParameterOptions(system, snapshot)
        if (availableParams.length === 0) {
          throw new Error('Subsystem has no continuation parameters available.')
        }
        const targetParameterRef = parseContinuationParameter(system, snapshot, request.parameterName)
        const targetRuntimeParameterName = resolveRuntimeParameterName(snapshot, targetParameterRef)

        let mapIterations: number | undefined
        if (canContinueEquilibrium && system.type === 'map') {
          const iterations = sourceBranch.mapIterations ?? 1
          if (
            !Number.isFinite(iterations) ||
            iterations <= 0 ||
            !Number.isInteger(iterations)
          ) {
            throw new Error('Cycle length must be a positive integer.')
          }
          mapIterations = iterations
        }

        const baseParams = getBranchParams(state.system, sourceBranch)
        let runConfig = buildReducedRunConfig(system, snapshot, baseParams)

        const sourceParamRef = sourceBranch.parameterRef
          ? sourceBranch.parameterRef
          : (() => {
              try {
                return parseContinuationParameter(system, snapshot, sourceBranch.parameterName)
              } catch {
                return null
              }
            })()
        if (sourceParamRef && Number.isFinite(point.param_value)) {
          const sourceRuntimeName = resolveRuntimeParameterName(snapshot, sourceParamRef)
          runConfig = applyReducedParamOverrides(runConfig, {
            [sourceRuntimeName]: point.param_value,
          })
        }
        runConfig = applyReducedParamOverrides(
          runConfig,
          resolveBranchPointReducedParamOverrides(sourceBranch, point)
        )

        const branchType: ContinuationObject['branchType'] = canContinueEquilibrium
          ? 'equilibrium'
          : 'limit_cycle'
        const normalized = canContinueEquilibrium
          ? normalizeBranchEigenvalues(
              await client.runEquilibriumContinuation(
                {
                  system: runConfig,
                  equilibriumState: projectStateForSnapshot(
                    snapshot,
                    point.state,
                    equilibriumLabel
                  ),
                  parameterName: targetRuntimeParameterName,
                  mapIterations,
                  settings: request.settings,
                  forward: request.forward,
                },
                {
                  onProgress: (progress) =>
                    dispatch({
                      type: 'SET_CONTINUATION_PROGRESS',
                      progress: { label: `${equilibriumLabel} continuation`, progress },
                    }),
                }
              )
            )
          : normalizeBranchEigenvalues(
              await client.runContinuationExtension(
                {
                  system: runConfig,
                  branchData: serializeBranchDataForWasm({
                    ...sourceBranch,
                    data: {
                      ...sourceBranch.data,
                      points: [
                        {
                          ...point,
                          // Remap seed point param_value to the selected continuation parameter.
                          // The source branch may have been continued in a different parameter.
                          param_value:
                            runConfig.params[
                              runConfig.paramNames.indexOf(targetRuntimeParameterName)
                            ] ?? point.param_value,
                        },
                      ],
                      bifurcations: [],
                      indices: [0],
                      upoldp: undefined,
                      resume_state: undefined,
                    },
                  }),
                  parameterName: targetRuntimeParameterName,
                  settings: request.settings,
                  forward: request.forward,
                },
                {
                  onProgress: (progress) =>
                    dispatch({
                      type: 'SET_CONTINUATION_PROGRESS',
                      progress: { label: 'Limit Cycle continuation', progress },
                    }),
                }
              ),
              { stateDimension: snapshot.freeVariableNames.length }
            )

        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: resolveDisplayParameterName(targetParameterRef),
          parameterRef: targetParameterRef,
          parentObject: sourceBranch.parentObject,
          startObject: sourceBranch.name,
          branchType,
          data: normalized,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          mapIterations,
          subsystemSnapshot: snapshot,
        }

        const parentNodeId = findObjectIdByName(state.system, sourceBranch.parentObject)
        if (!parentNodeId) {
          throw new Error(`Unable to locate the parent ${equilibriumLabelLower} in the tree.`)
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const nextSystem =
          branchType === 'limit_cycle' && normalized.points.length > 0
            ? updateLimitCycleRenderTarget(created.system, parentNodeId, {
                type: 'branch',
                branchId: created.nodeId,
                pointIndex: normalized.points.length - 1,
              })
            : created.system
        const selected = selectNode(nextSystem, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const extendBranch = useCallback(
    async (request: BranchExtensionRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const equilibriumLabelLower = formatEquilibriumLabel(system.type, { lowercase: true })
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to extend.')
        }
        if (
          ![
            'equilibrium',
            'limit_cycle',
            'homoclinic_curve',
            'fold_curve',
            'hopf_curve',
            'lpc_curve',
            'isochrone_curve',
            'pd_curve',
            'ns_curve',
          ].includes(sourceBranch.branchType)
        ) {
          throw new Error(
            `Branch extension is only available for ${equilibriumLabelLower}, limit cycle, homoclinic, or bifurcation curve branches.`
          )
        }
        if (!sourceBranch.data.points.length) {
          throw new Error('Branch has no points to extend.')
        }

        const sourceObjectId = findObjectIdByName(state.system, sourceBranch.parentObject)
        const sourceObjectCandidate = sourceObjectId ? state.system.objects[sourceObjectId] : undefined
        const sourceObject = isFreezableObject(sourceObjectCandidate) ? sourceObjectCandidate : null
        const snapshot = buildBranchSubsystemSnapshot(system, sourceBranch, sourceObject)
        const baseParams = getBranchParams(state.system, sourceBranch)
        let runConfig = buildReducedRunConfig(system, snapshot, baseParams)

        const mapIterations =
          system.type === 'map' &&
          ['equilibrium', 'fold_curve', 'hopf_curve'].includes(sourceBranch.branchType)
            ? sourceBranch.mapIterations ?? 1
            : undefined

        const branchTypeMeta = sourceBranch.data.branch_type
        const extensionLabel =
          branchTypeMeta &&
          typeof branchTypeMeta === 'object' &&
          'param1_name' in branchTypeMeta &&
          typeof branchTypeMeta.param1_name === 'string'
            ? branchTypeMeta.param1_name
            : sourceBranch.parameterName
        const extensionParameterRef =
          sourceBranch.parameterRef ??
          (branchTypeMeta &&
          typeof branchTypeMeta === 'object' &&
          'param1_ref' in branchTypeMeta &&
          branchTypeMeta.param1_ref
            ? branchTypeMeta.param1_ref
            : parseContinuationParameter(system, snapshot, extensionLabel))
        const extensionRuntimeName = resolveRuntimeParameterName(snapshot, extensionParameterRef)

        let updatedData: ContinuationObject['data'] | null = null
        const homocSourceData =
          sourceBranch.branchType === 'homoclinic_curve'
            ? ensureHomoclinicEndpointResumeSeeds(sourceBranch.data)
            : null
        if (sourceBranch.branchType === 'homoclinic_curve') {
          const sourceType = homocSourceData?.branch_type
          if (!sourceType || sourceType.type !== 'HomoclinicCurve') {
            throw new Error(
              'Homoclinic branch metadata is missing. Reinitialize from a valid homoclinic point.'
            )
          }
          const endpoint = resolveExtensionEndpointArrayIndex(sourceBranch, request.forward)
          const endpointPoint = sourceBranch.data.points[endpoint.arrayIndex]
          if (!endpointPoint) {
            throw new Error('Unable to resolve a valid homoclinic endpoint for extension.')
          }
          const sourceParam1Ref = sourceType.param1_ref ?? extensionParameterRef
          const sourceParam1Runtime = resolveRuntimeParameterName(snapshot, sourceParam1Ref)
          runConfig = applyReducedParamOverrides(runConfig, {
            [sourceParam1Runtime]: endpointPoint.param_value,
          })
          const sourceParam2Ref =
            sourceType.param2_ref ??
            (() => {
              try {
                return parseContinuationParameter(system, snapshot, sourceType.param2_name)
              } catch {
                return null
              }
            })()
          const sourceParam2Runtime = sourceParam2Ref
            ? resolveRuntimeParameterName(snapshot, sourceParam2Ref)
            : null
          const endpointParam2 =
            Number.isFinite(endpointPoint.param2_value)
              ? endpointPoint.param2_value
              : resolveContinuationPointParam2Value(
                  endpointPoint,
                  sourceBranch.data.branch_type,
                  snapshot.freeVariableNames.length
                )
          if (sourceParam2Runtime && Number.isFinite(endpointParam2)) {
            runConfig = applyReducedParamOverrides(runConfig, {
              [sourceParam2Runtime]: endpointParam2 as number,
            })
          }

          const branchData = serializeBranchDataForExtension(
            system,
            snapshot,
            sourceBranch,
            homocSourceData
          )
          updatedData = await client.runContinuationExtension(
            {
              system: runConfig,
              branchData,
              parameterName: sourceParam1Runtime,
              mapIterations,
              settings: request.settings,
              forward: request.forward,
            },
            {
              onProgress: (progress) =>
                dispatch({
                  type: 'SET_CONTINUATION_PROGRESS',
                  progress: { label: 'Homoclinic extension', progress },
                }),
            }
          )

          if (updatedData.points.length <= sourceBranch.data.points.length) {
            throw new Error(
              'Homoclinic extension stopped at the endpoint. Adjust step/mesh settings or initialize a new homoclinic branch from the selected point.'
            )
          }
        } else {
          const branchData = serializeBranchDataForExtension(
            system,
            snapshot,
            sourceBranch
          )

          updatedData = await client.runContinuationExtension(
            {
              system: runConfig,
              branchData,
              parameterName: extensionRuntimeName,
              mapIterations,
              settings: request.settings,
              forward: request.forward,
            },
            {
              onProgress: (progress) =>
                dispatch({
                  type: 'SET_CONTINUATION_PROGRESS',
                  progress: { label: 'Extension', progress },
                }),
            }
          )
        }
        if (!updatedData) {
          throw new Error('Branch extension did not return updated continuation data.')
        }

        const normalizedRaw = normalizeBranchEigenvalues(updatedData, {
          stateDimension: snapshot.freeVariableNames.length,
        })
        const normalizedWithMetadata = restoreExtendedBranchMetadata(
          system,
          snapshot,
          sourceBranch,
          normalizedRaw
        )
        const normalized =
          sourceBranch.branchType === 'homoclinic_curve'
            ? ensureHomoclinicEndpointResumeSeeds(normalizedWithMetadata)
            : normalizedWithMetadata
        const updatedBranch: ContinuationObject = {
          ...sourceBranch,
          data: normalized,
          settings: request.settings,
          subsystemSnapshot: snapshot,
        }

        let updated = updateBranch(state.system, request.branchId, updatedBranch)
        if (sourceBranch.branchType === 'limit_cycle' && normalized.points.length > 0) {
          const parentNodeId = findObjectIdByName(state.system, sourceBranch.parentObject)
          if (parentNodeId) {
            const lastIndex = normalized.points.length - 1
            updated = updateLimitCycleRenderTarget(updated, parentNodeId, {
              type: 'branch',
              branchId: request.branchId,
              pointIndex: lastIndex,
            })
          }
        }
        const selected = selectNode(updated, request.branchId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createFoldCurveFromPoint = useCallback(
    async (request: FoldCurveContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const equilibriumLabelLower = formatEquilibriumLabel(system.type, { lowercase: true })
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'equilibrium') {
          throw new Error(
            `Fold curve continuation is only available for ${equilibriumLabelLower} branches.`
          )
        }

        const point: ContinuationPoint | undefined =
          sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }
        if (point.stability !== 'Fold') {
          throw new Error('Selected point is not a Fold bifurcation.')
        }

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, sourceBranch.parentObject, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }

        const sourceObjectId = findObjectIdByName(state.system, sourceBranch.parentObject)
        const sourceObjectCandidate = sourceObjectId ? state.system.objects[sourceObjectId] : undefined
        const sourceObject = isFreezableObject(sourceObjectCandidate) ? sourceObjectCandidate : null
        const snapshot = buildBranchSubsystemSnapshot(system, sourceBranch, sourceObject)
        const param1Ref = sourceBranch.parameterRef
          ? sourceBranch.parameterRef
          : parseContinuationParameter(system, snapshot, sourceBranch.parameterName)
        const param2Ref = parseContinuationParameter(system, snapshot, request.param2Name)
        if (formatParameterRefLabel(param2Ref) === formatParameterRefLabel(param1Ref)) {
          throw new Error('Second parameter must be different from the continuation parameter.')
        }
        const param1Name = resolveRuntimeParameterName(snapshot, param1Ref)
        const param2Name = resolveRuntimeParameterName(snapshot, param2Ref)
        const param1DisplayName = resolveDisplayParameterName(param1Ref)
        const param2DisplayName = resolveDisplayParameterName(param2Ref)

        const baseParams = getBranchParams(state.system, sourceBranch)
        let runConfig = buildReducedRunConfig(system, snapshot, baseParams)
        runConfig = applyReducedParamOverrides(runConfig, {
          [param1Name]: point.param_value,
        })
        runConfig = applyReducedParamOverrides(
          runConfig,
          resolveBranchPointReducedParamOverrides(sourceBranch, point)
        )
        const param2Idx = runConfig.paramNames.indexOf(param2Name)
        const param2Value = runConfig.params[param2Idx] ?? Number.NaN
        if (!Number.isFinite(param2Value)) {
          throw new Error('Unable to resolve second continuation parameter value.')
        }

        const mapIterations =
          system.type === 'map' ? sourceBranch.mapIterations ?? 1 : undefined

        const curveData = await client.runFoldCurveContinuation(
          {
            system: runConfig,
            foldState: projectStateForSnapshot(snapshot, point.state, 'Fold point'),
            param1Name,
            param1Value: point.param_value,
            param2Name,
            param2Value,
            mapIterations,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Fold Curve', progress },
              }),
          }
        )
        if (curveData.points.length <= 1) {
          throw new Error(
            'Fold curve continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const branchData = normalizeBranchEigenvalues({
          points: curveData.points.map((pt) => ({
            state: pt.state || point.state,
            param_value: pt.param1_value,
            param2_value: pt.param2_value,
            stability: pt.codim2_type || 'None',
            eigenvalues: normalizeEigenvalueArray(pt.eigenvalues),
          })),
          bifurcations: curveData.codim2_bifurcations?.map((b) => b.index) || [],
          indices: curveData.points.map((_, i) => i),
          branch_type: {
            type: 'FoldCurve' as const,
            param1_name: param1DisplayName,
            param2_name: param2DisplayName,
            param1_ref: param1Ref,
            param2_ref: param2Ref,
          },
        }, { stateDimension: snapshot.freeVariableNames.length })

        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: `${param1DisplayName}, ${param2DisplayName}`,
          parameterRef: param1Ref,
          parameter2Ref: param2Ref,
          parentObject: sourceBranch.parentObject,
          startObject: sourceBranch.name,
          branchType: 'fold_curve',
          data: branchData,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          mapIterations,
          subsystemSnapshot: snapshot,
        }

        const parentNodeId = findObjectIdByName(state.system, sourceBranch.parentObject)
        if (!parentNodeId) {
          throw new Error(`Unable to locate the parent ${equilibriumLabelLower} in the tree.`)
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const selected = selectNode(created.system, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createHopfCurveFromPoint = useCallback(
    async (request: HopfCurveContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const equilibriumLabelLower = formatEquilibriumLabel(system.type, { lowercase: true })
        const hopfCurveLabel = 'Hopf'
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type === 'map') {
          throw new Error('Hopf curve continuation is only available for flow systems.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'equilibrium') {
          throw new Error(
            `${hopfCurveLabel} curve continuation is only available for ${equilibriumLabelLower} branches.`
          )
        }

        const point: ContinuationPoint | undefined =
          sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }
        if (point.stability !== 'Hopf') {
          throw new Error(`Selected point is not a ${hopfCurveLabel} bifurcation.`)
        }

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, sourceBranch.parentObject, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }

        const sourceObjectId = findObjectIdByName(state.system, sourceBranch.parentObject)
        const sourceObjectCandidate = sourceObjectId ? state.system.objects[sourceObjectId] : undefined
        const sourceObject = isFreezableObject(sourceObjectCandidate) ? sourceObjectCandidate : null
        const snapshot = buildBranchSubsystemSnapshot(system, sourceBranch, sourceObject)
        const param1Ref = sourceBranch.parameterRef
          ? sourceBranch.parameterRef
          : parseContinuationParameter(system, snapshot, sourceBranch.parameterName)
        const param2Ref = parseContinuationParameter(system, snapshot, request.param2Name)
        if (formatParameterRefLabel(param2Ref) === formatParameterRefLabel(param1Ref)) {
          throw new Error('Second parameter must be different from the continuation parameter.')
        }
        const param1Name = resolveRuntimeParameterName(snapshot, param1Ref)
        const param2Name = resolveRuntimeParameterName(snapshot, param2Ref)
        const param1DisplayName = resolveDisplayParameterName(param1Ref)
        const param2DisplayName = resolveDisplayParameterName(param2Ref)

        const baseParams = getBranchParams(state.system, sourceBranch)
        let runConfig = buildReducedRunConfig(system, snapshot, baseParams)
        runConfig = applyReducedParamOverrides(runConfig, {
          [param1Name]: point.param_value,
        })
        runConfig = applyReducedParamOverrides(
          runConfig,
          resolveBranchPointReducedParamOverrides(sourceBranch, point)
        )
        const param2Idx = runConfig.paramNames.indexOf(param2Name)
        const param2Value = runConfig.params[param2Idx] ?? Number.NaN
        if (!Number.isFinite(param2Value)) {
          throw new Error('Unable to resolve second continuation parameter value.')
        }
        const hopfOmega = extractHopfOmega(point)
        const mapIterations = undefined

        const curveData = await client.runHopfCurveContinuation(
          {
            system: runConfig,
            hopfState: projectStateForSnapshot(snapshot, point.state, 'Hopf point'),
            hopfOmega,
            param1Name,
            param1Value: point.param_value,
            param2Name,
            param2Value,
            mapIterations,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: `${hopfCurveLabel} Curve`, progress },
              }),
          }
        )
        if (curveData.points.length <= 1) {
          throw new Error(
            `${hopfCurveLabel} curve continuation stopped at the seed point. Try a smaller step size or adjust parameters.`
          )
        }

        const branchData = normalizeBranchEigenvalues({
          points: curveData.points.map((pt) => ({
            state: pt.state || point.state,
            param_value: pt.param1_value,
            param2_value: pt.param2_value,
            stability: pt.codim2_type || 'None',
            eigenvalues: normalizeEigenvalueArray(pt.eigenvalues),
            auxiliary: pt.auxiliary ?? undefined,
          })),
          bifurcations: curveData.codim2_bifurcations?.map((b) => b.index) || [],
          indices: curveData.points.map((_, i) => i),
          branch_type: {
            type: 'HopfCurve' as const,
            param1_name: param1DisplayName,
            param2_name: param2DisplayName,
            param1_ref: param1Ref,
            param2_ref: param2Ref,
          },
        }, { stateDimension: snapshot.freeVariableNames.length })

        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: `${param1DisplayName}, ${param2DisplayName}`,
          parameterRef: param1Ref,
          parameter2Ref: param2Ref,
          parentObject: sourceBranch.parentObject,
          startObject: sourceBranch.name,
          branchType: 'hopf_curve',
          data: branchData,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          mapIterations,
          subsystemSnapshot: snapshot,
        }

        const parentNodeId = findObjectIdByName(state.system, sourceBranch.parentObject)
        if (!parentNodeId) {
          throw new Error(`Unable to locate the parent ${equilibriumLabelLower} in the tree.`)
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const selected = selectNode(created.system, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createIsochroneCurveFromPoint = useCallback(
    async (request: IsochroneCurveContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type !== 'flow') {
          throw new Error('Isochrone continuation is only available for flow systems.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (
          sourceBranch.branchType !== 'limit_cycle' &&
          sourceBranch.branchType !== 'isochrone_curve'
        ) {
          throw new Error(
            'Isochrone continuation is only available for limit cycle or isochrone branches.'
          )
        }

        const point: ContinuationPoint | undefined =
          sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }
        const period = point.state[point.state.length - 1]
        if (!Number.isFinite(period) || period <= 0) {
          throw new Error('Selected point has no valid period.')
        }

        const branchType = sourceBranch.data.branch_type
        if (
          !branchType ||
          (branchType.type !== 'LimitCycle' && branchType.type !== 'IsochroneCurve')
        ) {
          throw new Error('Limit cycle mesh metadata is missing for this branch.')
        }
        const ntst = Math.max(1, Math.trunc(branchType.ntst ?? 20))
        const ncol = Math.max(1, Math.trunc(branchType.ncol ?? 4))

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, sourceBranch.parentObject, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }

        const sourceObjectId = findObjectIdByName(state.system, sourceBranch.parentObject)
        const sourceObjectCandidate = sourceObjectId ? state.system.objects[sourceObjectId] : undefined
        const sourceObject = isFreezableObject(sourceObjectCandidate) ? sourceObjectCandidate : null
        const snapshot = buildBranchSubsystemSnapshot(system, sourceBranch, sourceObject)
        const param1Ref = parseContinuationParameter(system, snapshot, request.parameterName)
        const param2Ref = parseContinuationParameter(system, snapshot, request.param2Name)
        if (formatParameterRefLabel(param2Ref) === formatParameterRefLabel(param1Ref)) {
          throw new Error('Second parameter must be different from the first continuation parameter.')
        }
        const param1Name = resolveRuntimeParameterName(snapshot, param1Ref)
        const param2Name = resolveRuntimeParameterName(snapshot, param2Ref)
        const param1DisplayName = resolveDisplayParameterName(param1Ref)
        const param2DisplayName = resolveDisplayParameterName(param2Ref)

        const baseParams = getBranchParams(state.system, sourceBranch)
        let runConfig = buildReducedRunConfig(system, snapshot, baseParams)

        if (sourceBranch.branchType === 'isochrone_curve' && branchType.type === 'IsochroneCurve') {
          const sourceParam1Ref =
            branchType.param1_ref ??
            sourceBranch.parameterRef ??
            parseContinuationParameter(system, snapshot, branchType.param1_name)
          const sourceParam1Name = resolveRuntimeParameterName(snapshot, sourceParam1Ref)
          runConfig = applyReducedParamOverrides(runConfig, {
            [sourceParam1Name]: point.param_value,
          })
          const sourceParam2Ref =
            branchType.param2_ref ??
            sourceBranch.parameter2Ref ??
            parseContinuationParameter(system, snapshot, branchType.param2_name)
          const sourceParam2Name = resolveRuntimeParameterName(snapshot, sourceParam2Ref)
          const sourceParam2Value = resolveContinuationPointParam2Value(
            point,
            sourceBranch.data.branch_type,
            snapshot.freeVariableNames.length
          )
          if (Number.isFinite(sourceParam2Value)) {
            runConfig = applyReducedParamOverrides(runConfig, {
              [sourceParam2Name]: sourceParam2Value as number,
            })
          }
        }

        if (sourceBranch.branchType === 'limit_cycle') {
          const sourceParam1Ref = sourceBranch.parameterRef
            ? sourceBranch.parameterRef
            : parseContinuationParameter(system, snapshot, sourceBranch.parameterName)
          const sourceParam1Name = resolveRuntimeParameterName(snapshot, sourceParam1Ref)
          runConfig = applyReducedParamOverrides(runConfig, {
            [sourceParam1Name]: point.param_value,
          })
        }

        const param1Idx = runConfig.paramNames.indexOf(param1Name)
        const param1Value = runConfig.params[param1Idx]
        if (!Number.isFinite(param1Value)) {
          throw new Error('Selected first continuation parameter has no valid value.')
        }

        const param2Idx = runConfig.paramNames.indexOf(param2Name)
        const param2Value = runConfig.params[param2Idx]
        if (!Number.isFinite(param2Value)) {
          throw new Error('Selected second continuation parameter has no valid value.')
        }

        const curveData = await client.runIsochroneCurveContinuation(
          {
            system: runConfig,
            lcState: point.state.slice(0, -1),
            period,
            param1Name,
            param1Value,
            param2Name,
            param2Value,
            ntst,
            ncol,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Isochrone Curve', progress },
              }),
          }
        )
        if (curveData.points.length <= 1) {
          throw new Error(
            'Isochrone continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const branchData = normalizeBranchEigenvalues({
          points: curveData.points.map((pt) => ({
            state: pt.state || point.state,
            param_value: pt.param1_value,
            param2_value: pt.param2_value,
            stability: pt.codim2_type || 'None',
            eigenvalues: normalizeEigenvalueArray(pt.eigenvalues),
            auxiliary: pt.auxiliary ?? undefined,
          })),
          bifurcations: curveData.codim2_bifurcations?.map((b) => b.index) || [],
          indices:
            curveData.indices && curveData.indices.length === curveData.points.length
              ? curveData.indices
              : curveData.points.map((_, i) => (request.forward || i === 0 ? i : -i)),
          branch_type: {
            type: 'IsochroneCurve' as const,
            param1_name: param1DisplayName,
            param2_name: param2DisplayName,
            param1_ref: param1Ref,
            param2_ref: param2Ref,
            ntst,
            ncol,
          },
        }, { stateDimension: snapshot.freeVariableNames.length })

        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: `${param1DisplayName}, ${param2DisplayName}`,
          parameterRef: param1Ref,
          parameter2Ref: param2Ref,
          parentObject: sourceBranch.parentObject,
          startObject: sourceBranch.name,
          branchType: 'isochrone_curve',
          data: branchData,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          subsystemSnapshot: snapshot,
        }

        const parentNodeId = findObjectIdByName(state.system, sourceBranch.parentObject)
        if (!parentNodeId) {
          throw new Error('Unable to locate the parent limit cycle in the tree.')
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const selected = selectNode(created.system, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createNSCurveFromPoint = useCallback(
    async (request: MapNSCurveContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const equilibriumLabelLower = formatEquilibriumLabel(system.type, { lowercase: true })
        const nsCurveLabel = 'Neimark-Sacker'
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type !== 'map') {
          throw new Error('Neimark-Sacker curve continuation is only available for map systems.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'equilibrium') {
          throw new Error(
            `${nsCurveLabel} curve continuation is only available for ${equilibriumLabelLower} branches.`
          )
        }

        const point: ContinuationPoint | undefined =
          sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }
        if (point.stability !== 'NeimarkSacker') {
          throw new Error(`Selected point is not a ${nsCurveLabel} bifurcation.`)
        }

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, sourceBranch.parentObject, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }

        const sourceObjectId = findObjectIdByName(state.system, sourceBranch.parentObject)
        const sourceObjectCandidate = sourceObjectId ? state.system.objects[sourceObjectId] : undefined
        const sourceObject = isFreezableObject(sourceObjectCandidate) ? sourceObjectCandidate : null
        const snapshot = buildBranchSubsystemSnapshot(system, sourceBranch, sourceObject)
        const param1Ref = sourceBranch.parameterRef
          ? sourceBranch.parameterRef
          : parseContinuationParameter(system, snapshot, sourceBranch.parameterName)
        const param2Ref = parseContinuationParameter(system, snapshot, request.param2Name)
        if (formatParameterRefLabel(param2Ref) === formatParameterRefLabel(param1Ref)) {
          throw new Error('Second parameter must be different from the continuation parameter.')
        }
        const param1Name = resolveRuntimeParameterName(snapshot, param1Ref)
        const param2Name = resolveRuntimeParameterName(snapshot, param2Ref)
        const param1DisplayName = resolveDisplayParameterName(param1Ref)
        const param2DisplayName = resolveDisplayParameterName(param2Ref)

        const baseParams = getBranchParams(state.system, sourceBranch)
        let runConfig = buildReducedRunConfig(system, snapshot, baseParams)
        runConfig = applyReducedParamOverrides(runConfig, {
          [param1Name]: point.param_value,
        })
        runConfig = applyReducedParamOverrides(
          runConfig,
          resolveBranchPointReducedParamOverrides(sourceBranch, point)
        )
        const param2Idx = runConfig.paramNames.indexOf(param2Name)
        const param2Value = runConfig.params[param2Idx] ?? Number.NaN
        if (!Number.isFinite(param2Value)) {
          throw new Error('Unable to resolve second continuation parameter value.')
        }
        const hopfOmega = extractHopfOmega(point)
        const mapIterations = sourceBranch.mapIterations ?? 1

        const curveData = await client.runHopfCurveContinuation(
          {
            system: runConfig,
            hopfState: projectStateForSnapshot(snapshot, point.state, `${nsCurveLabel} point`),
            hopfOmega,
            param1Name,
            param1Value: point.param_value,
            param2Name,
            param2Value,
            mapIterations,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: `${nsCurveLabel} Curve`, progress },
              }),
          }
        )
        if (curveData.points.length <= 1) {
          throw new Error(
            `${nsCurveLabel} curve continuation stopped at the seed point. Try a smaller step size or adjust parameters.`
          )
        }

        const branchData = normalizeBranchEigenvalues({
          points: curveData.points.map((pt) => ({
            state: pt.state || point.state,
            param_value: pt.param1_value,
            param2_value: pt.param2_value,
            stability: pt.codim2_type || 'None',
            eigenvalues: normalizeEigenvalueArray(pt.eigenvalues),
            auxiliary: pt.auxiliary ?? undefined,
          })),
          bifurcations: curveData.codim2_bifurcations?.map((b) => b.index) || [],
          indices: curveData.points.map((_, i) => i),
          branch_type: {
            type: 'HopfCurve' as const,
            param1_name: param1DisplayName,
            param2_name: param2DisplayName,
            param1_ref: param1Ref,
            param2_ref: param2Ref,
          },
        }, { stateDimension: snapshot.freeVariableNames.length })

        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: `${param1DisplayName}, ${param2DisplayName}`,
          parameterRef: param1Ref,
          parameter2Ref: param2Ref,
          parentObject: sourceBranch.parentObject,
          startObject: sourceBranch.name,
          branchType: 'hopf_curve',
          data: branchData,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          mapIterations,
          subsystemSnapshot: snapshot,
        }

        const parentNodeId = findObjectIdByName(state.system, sourceBranch.parentObject)
        if (!parentNodeId) {
          throw new Error(`Unable to locate the parent ${equilibriumLabelLower} in the tree.`)
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const selected = selectNode(created.system, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createLimitCycleFromHopf = useCallback(
    async (request: LimitCycleHopfContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const equilibriumLabelLower = formatEquilibriumLabel(system.type, { lowercase: true })
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type === 'map') {
          throw new Error('Limit cycles require a flow system.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (
          sourceBranch.branchType !== 'equilibrium' &&
          sourceBranch.branchType !== 'hopf_curve'
        ) {
          throw new Error(
            `Limit cycle continuation is only available for ${equilibriumLabelLower} or Hopf curve branches.`
          )
        }

        const point: ContinuationPoint | undefined =
          sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }
        if (sourceBranch.branchType === 'equilibrium' && point.stability !== 'Hopf') {
          throw new Error('Selected point is not a Hopf bifurcation.')
        }

        const limitCycleName = request.limitCycleName.trim()
        const limitCycleNameError = validateObjectName(limitCycleName, 'Limit cycle')
        if (limitCycleNameError) {
          throw new Error(limitCycleNameError)
        }
        const existingNames = Object.values(state.system.objects).map((obj) => obj.name)
        if (existingNames.includes(limitCycleName)) {
          throw new Error(`Object "${limitCycleName}" already exists.`)
        }

        const branchName = request.branchName.trim()
        const branchNameError = validateBranchName(branchName)
        if (branchNameError) {
          throw new Error(branchNameError)
        }
        if (branchNameExists(state.system, limitCycleName, branchName)) {
          throw new Error(`Branch "${branchName}" already exists.`)
        }

        if (!Number.isFinite(request.amplitude) || request.amplitude <= 0) {
          throw new Error('Amplitude must be a positive number.')
        }
        if (!Number.isFinite(request.ntst) || request.ntst <= 0) {
          throw new Error('NTST must be a positive integer.')
        }
        if (!Number.isFinite(request.ncol) || request.ncol <= 0) {
          throw new Error('NCOL must be a positive integer.')
        }

        const sourceObjectId = findObjectIdByName(state.system, sourceBranch.parentObject)
        const sourceObjectCandidate = sourceObjectId ? state.system.objects[sourceObjectId] : undefined
        const sourceObject = isFreezableObject(sourceObjectCandidate) ? sourceObjectCandidate : null
        const snapshot = buildBranchSubsystemSnapshot(system, sourceBranch, sourceObject)
        const parameterRef = parseContinuationParameter(system, snapshot, request.parameterName)
        const parameterName = resolveRuntimeParameterName(snapshot, parameterRef)
        const parameterDisplayName = resolveDisplayParameterName(parameterRef)

        const baseParams = getBranchParams(state.system, sourceBranch)
        let runConfig = buildReducedRunConfig(system, snapshot, baseParams)

        if (sourceBranch.branchType === 'equilibrium') {
          const sourceParamRef = sourceBranch.parameterRef
            ? sourceBranch.parameterRef
            : parseContinuationParameter(system, snapshot, sourceBranch.parameterName)
          const sourceParamName = resolveRuntimeParameterName(snapshot, sourceParamRef)
          runConfig = applyReducedParamOverrides(runConfig, {
            [sourceParamName]: point.param_value,
          })
        } else if (sourceBranch.branchType === 'hopf_curve') {
          const branchType = sourceBranch.data.branch_type
          const codim1Params =
            branchType &&
            typeof branchType === 'object' &&
            'param1_name' in branchType &&
            'param2_name' in branchType
              ? {
                  param1:
                    branchType.param1_ref ??
                    parseContinuationParameter(system, snapshot, branchType.param1_name),
                  param2:
                    branchType.param2_ref ??
                    parseContinuationParameter(system, snapshot, branchType.param2_name),
                }
              : null
          if (!codim1Params) {
            throw new Error('Hopf curve parameters are not defined in this branch.')
          }
          const param1Name = resolveRuntimeParameterName(snapshot, codim1Params.param1)
          runConfig = applyReducedParamOverrides(runConfig, {
            [param1Name]: point.param_value,
          })
          const param2Value =
            Number.isFinite(point.param2_value) || point.param2_value === 0
              ? point.param2_value
              : resolveContinuationPointParam2Value(
                  point,
                  sourceBranch.data.branch_type,
                  snapshot.freeVariableNames.length
                )
          if (!Number.isFinite(param2Value)) {
            throw new Error('Hopf curve point is missing the secondary parameter value.')
          }
          const param2Name = resolveRuntimeParameterName(snapshot, codim1Params.param2)
          runConfig = applyReducedParamOverrides(runConfig, {
            [param2Name]: param2Value as number,
          })
        }

        const paramIndex = runConfig.paramNames.indexOf(parameterName)
        if (paramIndex < 0) {
          throw new Error('Continuation parameter is not defined in this system.')
        }
        const paramValue = runConfig.params[paramIndex]
        if (!Number.isFinite(paramValue)) {
          throw new Error('Continuation parameter value is not finite.')
        }

        const branchData = await client.runLimitCycleContinuationFromHopf(
          {
            system: runConfig,
            hopfState: projectStateForSnapshot(snapshot, point.state, 'Hopf point'),
            parameterName,
            paramValue,
            amplitude: request.amplitude,
            ntst: Math.round(request.ntst),
            ncol: Math.round(request.ncol),
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Limit Cycle', progress },
              }),
          }
        )

        if (branchData.points.length <= 1) {
          throw new Error(
            'Limit cycle continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const indices =
          branchData.indices && branchData.indices.length === branchData.points.length
            ? branchData.indices
            : branchData.points.map((_, index) => index)

        const normalizedBranchData = normalizeBranchEigenvalues({
          ...branchData,
          indices,
          branch_type:
            branchData.branch_type ?? {
              type: 'LimitCycle' as const,
              ntst: Math.round(request.ntst),
              ncol: Math.round(request.ncol),
            },
        }, { stateDimension: snapshot.freeVariableNames.length })

        const firstPoint = normalizedBranchData.points[0]
        if (!firstPoint || firstPoint.state.length === 0) {
          throw new Error('Limit cycle continuation did not return a valid initial state.')
        }

        const period = firstPoint.state[firstPoint.state.length - 1]
        if (!Number.isFinite(period) || period <= 0) {
          throw new Error('Limit cycle continuation returned an invalid period.')
        }

        const logicalIndex =
          sourceBranch.data.indices?.[request.pointIndex] ?? request.pointIndex

        const lcObj: LimitCycleObject = {
          type: 'limit_cycle',
          name: limitCycleName,
          systemName: system.name,
          origin: {
            type: 'hopf',
            equilibriumObjectName: sourceBranch.parentObject,
            equilibriumBranchName: sourceBranch.name,
            pointIndex: logicalIndex,
          },
          ntst: Math.round(request.ntst),
          ncol: Math.round(request.ncol),
          period,
          state: firstPoint.state,
          parameters: [...baseParams],
          parameterName: parameterDisplayName,
          parameterRef,
          paramValue: firstPoint.param_value,
          createdAt: new Date().toISOString(),
          frozenVariables: { frozenValuesByVarName: { ...snapshot.frozenValuesByVarName } },
          subsystemSnapshot: snapshot,
        }

        const added = addObject(state.system, lcObj)
        const branch: ContinuationObject = {
          type: 'continuation',
          name: branchName,
          systemName: system.name,
          parameterName: parameterDisplayName,
          parameterRef,
          parentObject: limitCycleName,
          startObject: limitCycleName,
          branchType: 'limit_cycle',
          data: normalizedBranchData,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          subsystemSnapshot: snapshot,
        }

        const createdBranch = addBranch(added.system, branch, added.nodeId)
        const lastIndex = normalizedBranchData.points.length - 1
        const withTarget = updateLimitCycleRenderTarget(
          createdBranch.system,
          added.nodeId,
          {
            type: 'branch',
            branchId: createdBranch.nodeId,
            pointIndex: lastIndex,
          }
        )
        const selected = selectNode(withTarget, createdBranch.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createLimitCycleFromOrbit = useCallback(
    async (request: LimitCycleOrbitContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        const orbit = state.system.objects[request.orbitId]
        if (!orbit || orbit.type !== 'orbit') {
          throw new Error('Select a valid orbit for limit cycle continuation.')
        }
        if (orbit.data.length === 0) {
          throw new Error('Orbit has no data to continue.')
        }

        const limitCycleName = request.limitCycleName.trim()
        const limitCycleNameError = validateObjectName(limitCycleName, 'Limit cycle')
        if (limitCycleNameError) {
          throw new Error(limitCycleNameError)
        }
        const existingNames = Object.values(state.system.objects).map((obj) => obj.name)
        if (existingNames.includes(limitCycleName)) {
          throw new Error(`Object "${limitCycleName}" already exists.`)
        }

        const branchName = request.branchName.trim()
        const branchNameError = validateBranchName(branchName)
        if (branchNameError) {
          throw new Error(branchNameError)
        }
        if (branchNameExists(state.system, limitCycleName, branchName)) {
          throw new Error(`Branch "${branchName}" already exists.`)
        }

        if (!Number.isFinite(request.tolerance) || request.tolerance <= 0) {
          throw new Error('Tolerance must be a positive number.')
        }
        if (!Number.isFinite(request.ntst) || request.ntst <= 0) {
          throw new Error('NTST must be a positive integer.')
        }
        if (!Number.isFinite(request.ncol) || request.ncol <= 0) {
          throw new Error('NCOL must be a positive integer.')
        }

        const snapshot = buildObjectSubsystemSnapshot(system, orbit)
        const parameterRef = parseContinuationParameter(system, snapshot, request.parameterName)
        const parameterName = resolveRuntimeParameterName(snapshot, parameterRef)
        const parameterDisplayName = resolveDisplayParameterName(parameterRef)
        const baseParams = resolveObjectParams(system, orbit.customParameters)
        const runConfig = buildReducedRunConfig(system, snapshot, baseParams)

        const paramIndex = runConfig.paramNames.indexOf(parameterName)
        if (paramIndex < 0) {
          throw new Error('Continuation parameter is not defined in this system.')
        }
        const paramValue = runConfig.params[paramIndex]
        if (!Number.isFinite(paramValue)) {
          throw new Error('Continuation parameter value is not finite.')
        }

        const reducedRows = mapStateRowsToReduced(snapshot, orbit.data)
        const orbitTimes = reducedRows.map((entry) => entry[0])
        const orbitStates = reducedRows.map((entry) => entry.slice(1))

        const branchData = await client.runLimitCycleContinuationFromOrbit(
          {
            system: runConfig,
            orbitTimes,
            orbitStates,
            parameterName,
            paramValue,
            tolerance: request.tolerance,
            ntst: Math.round(request.ntst),
            ncol: Math.round(request.ncol),
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Limit Cycle', progress },
              }),
          }
        )

        if (branchData.points.length <= 1) {
          throw new Error(
            'Limit cycle continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const indices =
          branchData.indices && branchData.indices.length === branchData.points.length
            ? branchData.indices
            : branchData.points.map((_, index) => index)

        const normalizedBranchData = normalizeBranchEigenvalues({
          ...branchData,
          indices,
          branch_type:
            branchData.branch_type ?? {
              type: 'LimitCycle' as const,
              ntst: Math.round(request.ntst),
              ncol: Math.round(request.ncol),
            },
        }, { stateDimension: snapshot.freeVariableNames.length })

        const firstPoint = normalizedBranchData.points[0]
        if (!firstPoint || firstPoint.state.length === 0) {
          throw new Error('Limit cycle continuation did not return a valid initial state.')
        }

        const period = firstPoint.state[firstPoint.state.length - 1]
        if (!Number.isFinite(period) || period <= 0) {
          throw new Error('Limit cycle continuation returned an invalid period.')
        }

        const lcObj: LimitCycleObject = {
          type: 'limit_cycle',
          name: limitCycleName,
          systemName: system.name,
          origin: { type: 'orbit', orbitName: orbit.name },
          ntst: Math.round(request.ntst),
          ncol: Math.round(request.ncol),
          period,
          state: firstPoint.state,
          parameters: [...baseParams],
          parameterName: parameterDisplayName,
          parameterRef,
          paramValue: firstPoint.param_value,
          floquetMultipliers: firstPoint.eigenvalues,
          createdAt: new Date().toISOString(),
          frozenVariables: normalizeObjectFrozenVariables(system, orbit),
          subsystemSnapshot: snapshot,
        }

        const added = addObject(state.system, lcObj)
        const branch: ContinuationObject = {
          type: 'continuation',
          name: branchName,
          systemName: system.name,
          parameterName: parameterDisplayName,
          parameterRef,
          parentObject: limitCycleName,
          startObject: orbit.name,
          branchType: 'limit_cycle',
          data: normalizedBranchData,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          subsystemSnapshot: snapshot,
        }

        const createdBranch = addBranch(added.system, branch, added.nodeId)
        const lastIndex = normalizedBranchData.points.length - 1
        const withTarget = updateLimitCycleRenderTarget(
          createdBranch.system,
          added.nodeId,
          {
            type: 'branch',
            branchId: createdBranch.nodeId,
            pointIndex: lastIndex,
          }
        )
        const selected = selectNode(withTarget, createdBranch.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createCycleFromPD = useCallback(
    async (request: MapCyclePDContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type !== 'map') {
          throw new Error('Cycle continuation is only available for map systems.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'equilibrium') {
          throw new Error('Period-doubling branching for maps requires a cycle branch.')
        }

        const point = sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }

        if (point.stability !== 'PeriodDoubling') {
          throw new Error('Selected point is not a Period Doubling bifurcation.')
        }

        const cycleName = request.cycleName.trim()
        const cycleNameError = validateObjectName(cycleName, 'Cycle')
        if (cycleNameError) {
          throw new Error(cycleNameError)
        }
        const existingNames = Object.values(state.system.objects).map((obj) => obj.name)
        if (existingNames.includes(cycleName)) {
          throw new Error(`Object "${cycleName}" already exists.`)
        }

        const branchName = request.branchName.trim()
        const branchNameError = validateBranchName(branchName)
        if (branchNameError) {
          throw new Error(branchNameError)
        }
        if (branchNameExists(state.system, cycleName, branchName)) {
          throw new Error(`Branch "${branchName}" already exists.`)
        }

        if (!Number.isFinite(request.amplitude) || request.amplitude <= 0) {
          throw new Error('Amplitude must be a positive number.')
        }

        const sourceObjectId = findObjectIdByName(state.system, sourceBranch.parentObject)
        const sourceObjectCandidate = sourceObjectId ? state.system.objects[sourceObjectId] : undefined
        const sourceObject = isFreezableObject(sourceObjectCandidate) ? sourceObjectCandidate : null
        const snapshot = buildBranchSubsystemSnapshot(system, sourceBranch, sourceObject)
        const parameterRef = sourceBranch.parameterRef
          ? sourceBranch.parameterRef
          : parseContinuationParameter(system, snapshot, sourceBranch.parameterName)
        const parameterName = resolveRuntimeParameterName(snapshot, parameterRef)
        const parameterDisplayName = resolveDisplayParameterName(parameterRef)
        const baseParams = getBranchParams(state.system, sourceBranch)
        let runConfig = buildReducedRunConfig(system, snapshot, baseParams)
        runConfig = applyReducedParamOverrides(runConfig, {
          [parameterName]: point.param_value,
        })
        runConfig = applyReducedParamOverrides(
          runConfig,
          resolveBranchPointReducedParamOverrides(sourceBranch, point)
        )

        const sourceIterations = Math.max(
          sourceBranch.mapIterations ?? point.cycle_points?.length ?? 1,
          1
        )
        const solverMaxSteps = request.solverParams.maxSteps
        const solverDamping = request.solverParams.dampingFactor
        const solverMapIterations =
          request.solverParams.mapIterations ?? sourceIterations * 2
        if (!Number.isFinite(solverMaxSteps) || solverMaxSteps <= 0) {
          throw new Error('Max steps must be a positive number.')
        }
        if (!Number.isFinite(solverDamping) || solverDamping <= 0) {
          throw new Error('Damping factor must be a positive number.')
        }
        if (
          !Number.isFinite(solverMapIterations) ||
          solverMapIterations <= 0 ||
          !Number.isInteger(solverMapIterations)
        ) {
          throw new Error('Cycle length must be a positive integer.')
        }

        const branchData = await client.runMapCycleContinuationFromPD(
          {
            system: runConfig,
            pdState: projectStateForSnapshot(snapshot, point.state, 'PD point'),
            parameterName,
            paramValue: point.param_value,
            mapIterations: sourceIterations,
            amplitude: request.amplitude,
            settings: request.settings,
            forward: request.forward,
            solverParams: {
              maxSteps: solverMaxSteps,
              dampingFactor: solverDamping,
              mapIterations: solverMapIterations,
            },
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Cycle', progress },
              }),
          }
        )

        if (branchData.points.length <= 1) {
          throw new Error(
            'Cycle continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const indices =
          branchData.indices && branchData.indices.length === branchData.points.length
            ? branchData.indices
            : branchData.points.map((_, index) => index)

        const normalizedBranchData = normalizeBranchEigenvalues({
          ...branchData,
          indices,
        }, { stateDimension: snapshot.freeVariableNames.length })

        const firstPoint = normalizedBranchData.points[0]
        if (!firstPoint || firstPoint.state.length === 0) {
          throw new Error('Cycle continuation did not return a valid initial state.')
        }

        const solution = {
          state: firstPoint.state,
          residual_norm: 0,
          iterations: 0,
          jacobian: [],
          eigenpairs: (firstPoint.eigenvalues ?? []).map((eig) => ({
            value: eig,
            vector: [],
          })),
          cycle_points: firstPoint.cycle_points,
        }

        const eqObj: EquilibriumObject = {
          type: 'equilibrium',
          name: cycleName,
          systemName: system.name,
          solution,
          parameters: [...baseParams],
          lastSolverParams: {
            initialGuess: firstPoint.state,
            maxSteps: solverMaxSteps,
            dampingFactor: solverDamping,
            mapIterations: solverMapIterations,
          },
          frozenVariables: { frozenValuesByVarName: { ...snapshot.frozenValuesByVarName } },
          subsystemSnapshot: snapshot,
        }

        const added = addObject(state.system, eqObj)
        const branch: ContinuationObject = {
          type: 'continuation',
          name: branchName,
          systemName: system.name,
          parameterName: parameterDisplayName,
          parameterRef,
          parentObject: cycleName,
          startObject: sourceBranch.name,
          branchType: 'equilibrium',
          data: normalizedBranchData,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          mapIterations: solverMapIterations,
          subsystemSnapshot: snapshot,
        }

        const createdBranch = addBranch(added.system, branch, added.nodeId)
        const selected = selectNode(createdBranch.system, createdBranch.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createLimitCycleFromPD = useCallback(
    async (request: LimitCyclePDContinuationRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type === 'map') {
          throw new Error('Limit cycle continuation is only available for flow systems.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'limit_cycle') {
          throw new Error(
            'Period-doubling branching is only available for limit cycle branches.'
          )
        }

        const point = sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }
        if (point.stability !== 'PeriodDoubling') {
          throw new Error('Selected point is not a Period Doubling bifurcation.')
        }

        const limitCycleName = request.limitCycleName.trim()
        const limitCycleNameError = validateObjectName(limitCycleName, 'Limit cycle')
        if (limitCycleNameError) {
          throw new Error(limitCycleNameError)
        }
        const existingNames = Object.values(state.system.objects).map((obj) => obj.name)
        if (existingNames.includes(limitCycleName)) {
          throw new Error(`Object "${limitCycleName}" already exists.`)
        }

        const branchName = request.branchName.trim()
        const branchNameError = validateBranchName(branchName)
        if (branchNameError) {
          throw new Error(branchNameError)
        }
        if (branchNameExists(state.system, limitCycleName, branchName)) {
          throw new Error(`Branch "${branchName}" already exists.`)
        }

        if (!Number.isFinite(request.amplitude) || request.amplitude <= 0) {
          throw new Error('Amplitude must be a positive number.')
        }
        if (!Number.isFinite(request.ncol) || request.ncol <= 0) {
          throw new Error('NCOL must be a positive integer.')
        }

        const sourceObjectId = findObjectIdByName(state.system, sourceBranch.parentObject)
        const sourceObjectCandidate = sourceObjectId ? state.system.objects[sourceObjectId] : undefined
        const sourceObject = isFreezableObject(sourceObjectCandidate) ? sourceObjectCandidate : null
        const snapshot = buildBranchSubsystemSnapshot(system, sourceBranch, sourceObject)
        const parameterRef = sourceBranch.parameterRef
          ? sourceBranch.parameterRef
          : parseContinuationParameter(system, snapshot, sourceBranch.parameterName)
        const parameterName = resolveRuntimeParameterName(snapshot, parameterRef)
        const parameterDisplayName = resolveDisplayParameterName(parameterRef)

        let sourceNtst = 20
        const branchType = sourceBranch.data.branch_type
        if (branchType?.type === 'LimitCycle') {
          sourceNtst = branchType.ntst
        }

        const baseParams = getBranchParams(state.system, sourceBranch)
        let runConfig = buildReducedRunConfig(system, snapshot, baseParams)
        runConfig = applyReducedParamOverrides(runConfig, {
          [parameterName]: point.param_value,
        })
        runConfig = applyReducedParamOverrides(
          runConfig,
          resolveBranchPointReducedParamOverrides(sourceBranch, point)
        )

        const branchData = await client.runLimitCycleContinuationFromPD(
          {
            system: runConfig,
            lcState: projectStateForSnapshot(snapshot, point.state, 'PD point'),
            parameterName,
            paramValue: point.param_value,
            ntst: Math.round(sourceNtst),
            ncol: Math.round(request.ncol),
            amplitude: request.amplitude,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Limit Cycle', progress },
              }),
          }
        )

        if (branchData.points.length <= 1) {
          throw new Error(
            'Limit cycle continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const indices =
          branchData.indices && branchData.indices.length === branchData.points.length
            ? branchData.indices
            : branchData.points.map((_, index) => index)

        const normalizedBranchData = normalizeBranchEigenvalues({
          ...branchData,
          indices,
          branch_type:
            branchData.branch_type ?? {
              type: 'LimitCycle' as const,
              ntst: Math.round(sourceNtst * 2),
              ncol: Math.round(request.ncol),
            },
        }, { stateDimension: snapshot.freeVariableNames.length })

        const firstPoint = normalizedBranchData.points[0]
        if (!firstPoint || firstPoint.state.length === 0) {
          throw new Error('Limit cycle continuation did not return a valid initial state.')
        }

        const period = firstPoint.state[firstPoint.state.length - 1]
        if (!Number.isFinite(period) || period <= 0) {
          throw new Error('Limit cycle continuation returned an invalid period.')
        }

        let objNtst = Math.round(sourceNtst * 2)
        let objNcol = Math.round(request.ncol)
        const normalizedType = normalizedBranchData.branch_type
        if (normalizedType?.type === 'LimitCycle') {
          objNtst = normalizedType.ntst
          objNcol = normalizedType.ncol
        }

        const lcObj: LimitCycleObject = {
          type: 'limit_cycle',
          name: limitCycleName,
          systemName: system.name,
          origin: {
            type: 'pd',
            sourceLimitCycleObjectName: sourceBranch.parentObject,
            sourceBranchName: sourceBranch.name,
            pointIndex: request.pointIndex,
          },
          ntst: objNtst,
          ncol: objNcol,
          period,
          state: firstPoint.state,
          parameters: [...baseParams],
          parameterName: parameterDisplayName,
          parameterRef,
          paramValue: firstPoint.param_value,
          floquetMultipliers: firstPoint.eigenvalues,
          createdAt: new Date().toISOString(),
          frozenVariables: { frozenValuesByVarName: { ...snapshot.frozenValuesByVarName } },
          subsystemSnapshot: snapshot,
        }

        const added = addObject(state.system, lcObj)
        const branch: ContinuationObject = {
          type: 'continuation',
          name: branchName,
          systemName: system.name,
          parameterName: parameterDisplayName,
          parameterRef,
          parentObject: limitCycleName,
          startObject: sourceBranch.name,
          branchType: 'limit_cycle',
          data: normalizedBranchData,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          subsystemSnapshot: snapshot,
        }

        const createdBranch = addBranch(added.system, branch, added.nodeId)
        const lastIndex = normalizedBranchData.points.length - 1
        const withTarget = updateLimitCycleRenderTarget(
          createdBranch.system,
          added.nodeId,
          {
            type: 'branch',
            branchId: createdBranch.nodeId,
            pointIndex: lastIndex,
          }
        )
        const selected = selectNode(withTarget, createdBranch.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createHomoclinicFromLargeCycle = useCallback(
    async (request: HomoclinicFromLargeCycleRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type === 'map') {
          throw new Error('Homoclinic continuation is only available for flow systems.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'limit_cycle') {
          throw new Error('Homoclinic initialization from a cycle requires a limit cycle branch.')
        }

        const point = sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }
        const multipliers = normalizeEigenvalueArray(point.eigenvalues)
        if (multipliers.length > 0) {
          const hasUnitMultiplier = multipliers
            .map((value) => Math.hypot(value.re, value.im))
            .some((magnitude) => Number.isFinite(magnitude) && Math.abs(magnitude - 1) < 0.5)
          if (!hasUnitMultiplier) {
            throw new Error(
              'Selected limit cycle point is numerically ill-conditioned (no Floquet multiplier near 1). Pick an earlier large-period point before multiplier blow-up.'
            )
          }
        }

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, sourceBranch.parentObject, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }

        const sourceObjectId = findObjectIdByName(state.system, sourceBranch.parentObject)
        const sourceObjectCandidate = sourceObjectId ? state.system.objects[sourceObjectId] : undefined
        const sourceObject = isFreezableObject(sourceObjectCandidate) ? sourceObjectCandidate : null
        const snapshot = buildBranchSubsystemSnapshot(system, sourceBranch, sourceObject)
        const param1Ref = parseContinuationParameter(system, snapshot, request.parameterName)
        const param2Ref = parseContinuationParameter(system, snapshot, request.param2Name)
        if (formatParameterRefLabel(param2Ref) === formatParameterRefLabel(param1Ref)) {
          throw new Error('Second parameter must be different from the continuation parameter.')
        }
        const param1Name = resolveRuntimeParameterName(snapshot, param1Ref)
        const param2Name = resolveRuntimeParameterName(snapshot, param2Ref)
        const param1DisplayName = resolveDisplayParameterName(param1Ref)
        const param2DisplayName = resolveDisplayParameterName(param2Ref)

        if (
          !Number.isFinite(request.targetNtst) ||
          request.targetNtst < 2 ||
          !Number.isInteger(request.targetNtst)
        ) {
          throw new Error('Target NTST must be an integer greater than or equal to 2.')
        }
        if (
          !Number.isFinite(request.targetNcol) ||
          request.targetNcol < 1 ||
          !Number.isInteger(request.targetNcol)
        ) {
          throw new Error('Target NCOL must be a positive integer.')
        }
        if (!request.freeTime && !request.freeEps0 && !request.freeEps1) {
          throw new Error('At least one of T, eps0, or eps1 must be free.')
        }

        let sourceNtst = 20
        let sourceNcol = 4
        const sourceType = sourceBranch.data.branch_type
        if (sourceType?.type === 'LimitCycle') {
          sourceNtst = sourceType.ntst
          sourceNcol = sourceType.ncol
        }

        const baseParams = getBranchParams(state.system, sourceBranch)
        let runConfig = buildReducedRunConfig(system, snapshot, baseParams)
        runConfig = applyReducedParamOverrides(runConfig, {
          [param1Name]: point.param_value,
        })
        runConfig = applyReducedParamOverrides(
          runConfig,
          resolveBranchPointReducedParamOverrides(sourceBranch, point)
        )

        const branchData = await client.runHomoclinicFromLargeCycle(
          {
            system: runConfig,
            lcState: projectStateForSnapshot(snapshot, point.state, 'Large-cycle point'),
            sourceNtst,
            sourceNcol,
            parameterName: param1Name,
            param2Name,
            targetNtst: Math.round(request.targetNtst),
            targetNcol: Math.round(request.targetNcol),
            freeTime: request.freeTime,
            freeEps0: request.freeEps0,
            freeEps1: request.freeEps1,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Homoclinic', progress },
              }),
          }
        )

        if (branchData.points.length === 0) {
          throw new Error(
            'Homoclinic continuation stopped at the seed point. Try Free T = off with Free eps0/eps1 = on, a smaller step size (for example 1e-3), or select an earlier large-cycle point.'
          )
        }

        const indices =
          branchData.indices && branchData.indices.length === branchData.points.length
            ? branchData.indices
            : branchData.points.map((_, index) => index)

        const normalizedRaw = normalizeBranchEigenvalues(
          {
            ...branchData,
            indices,
            branch_type:
              branchData.branch_type ?? {
                type: 'HomoclinicCurve' as const,
                ntst: Math.round(request.targetNtst),
                ncol: Math.round(request.targetNcol),
                param1_name: param1DisplayName,
                param2_name: param2DisplayName,
                param1_ref: param1Ref,
                param2_ref: param2Ref,
                free_time: request.freeTime,
                free_eps0: request.freeEps0,
                free_eps1: request.freeEps1,
              },
          },
          { stateDimension: snapshot.freeVariableNames.length }
        )
        const normalized = ensureHomoclinicEndpointResumeSeeds(
          trimHomoclinicLargeCycleSeedPoint(normalizedRaw)
        )

        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: `${param1DisplayName}, ${param2DisplayName}`,
          parameterRef: param1Ref,
          parameter2Ref: param2Ref,
          parentObject: sourceBranch.parentObject,
          startObject: sourceBranch.name,
          branchType: 'homoclinic_curve',
          data: normalized,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          subsystemSnapshot: snapshot,
        }

        const parentNodeId = findObjectIdByName(state.system, sourceBranch.parentObject)
        if (!parentNodeId) {
          throw new Error('Unable to locate the parent object in the tree.')
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const selected = selectNode(created.system, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createHomoclinicFromHomoclinic = useCallback(
    async (request: HomoclinicFromHomoclinicRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type === 'map') {
          throw new Error('Homoclinic continuation is only available for flow systems.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'homoclinic_curve') {
          throw new Error(
            'Homoclinic reinitialization requires an existing homoclinic branch.'
          )
        }

        const point = sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }

        const sourceType = sourceBranch.data.branch_type
        if (!sourceType || sourceType.type !== 'HomoclinicCurve') {
          throw new Error('Source homoclinic branch is missing metadata.')
        }
        const sourceFreeTime = sourceType.free_time
        const sourceFreeEps0 = sourceType.free_eps0
        const sourceFreeEps1 = sourceType.free_eps1
        const sourceContext = sourceBranch.data.homoc_context

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, sourceBranch.parentObject, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }
        const sourceObjectId = findObjectIdByName(state.system, sourceBranch.parentObject)
        const sourceObjectCandidate = sourceObjectId ? state.system.objects[sourceObjectId] : undefined
        const sourceObject = isFreezableObject(sourceObjectCandidate) ? sourceObjectCandidate : null
        const snapshot = buildBranchSubsystemSnapshot(system, sourceBranch, sourceObject)
        const param1Ref = parseContinuationParameter(system, snapshot, request.parameterName)
        const param2Ref = parseContinuationParameter(system, snapshot, request.param2Name)
        if (formatParameterRefLabel(param2Ref) === formatParameterRefLabel(param1Ref)) {
          throw new Error('Second parameter must be different from the continuation parameter.')
        }
        const param1Name = resolveRuntimeParameterName(snapshot, param1Ref)
        const param2Name = resolveRuntimeParameterName(snapshot, param2Ref)
        const param1DisplayName = resolveDisplayParameterName(param1Ref)
        const param2DisplayName = resolveDisplayParameterName(param2Ref)

        if (
          !Number.isFinite(request.targetNtst) ||
          request.targetNtst < 2 ||
          !Number.isInteger(request.targetNtst)
        ) {
          throw new Error('Target NTST must be an integer greater than or equal to 2.')
        }
        if (
          !Number.isFinite(request.targetNcol) ||
          request.targetNcol < 1 ||
          !Number.isInteger(request.targetNcol)
        ) {
          throw new Error('Target NCOL must be a positive integer.')
        }
        if (!request.freeTime && !request.freeEps0 && !request.freeEps1) {
          throw new Error('At least one of T, eps0, or eps1 must be free.')
        }

        const baseParams = getBranchParams(state.system, sourceBranch)
        let runConfig = buildReducedRunConfig(system, snapshot, baseParams)
        const sourceParam1Ref =
          sourceType.param1_ref ??
          parseContinuationParameter(system, snapshot, sourceType.param1_name)
        const sourceParam1Name = resolveRuntimeParameterName(snapshot, sourceParam1Ref)
        runConfig = applyReducedParamOverrides(runConfig, {
          [sourceParam1Name]: point.param_value,
        })
        const sourceParam2Ref =
          sourceType.param2_ref ??
          parseContinuationParameter(system, snapshot, sourceType.param2_name)
        const sourceParam2Name = resolveRuntimeParameterName(snapshot, sourceParam2Ref)
        const sourceParam2Value = resolveContinuationPointParam2Value(
          point,
          sourceType,
          snapshot.freeVariableNames.length
        )
        if (Number.isFinite(sourceParam2Value)) {
          runConfig = applyReducedParamOverrides(runConfig, {
            [sourceParam2Name]: sourceParam2Value as number,
          })
        }

        const seedState = resolveHomoclinicSeedState(
          { ...point, state: projectStateForSnapshot(snapshot, point.state, 'Homoclinic point') },
          snapshot.freeVariableNames.length
        )
        const inferredFixed = inferHomoclinicFixedEpsFromPoint(
          seedState,
          sourceType.ntst,
          sourceType.ncol,
          snapshot.freeVariableNames.length
        )
        const sourceFixedTime = sourceContext?.fixed_time ?? Number.NaN
        const sourceFixedEps0 = sourceContext?.fixed_eps0 ?? inferredFixed.eps0
        const sourceFixedEps1 = sourceContext?.fixed_eps1 ?? inferredFixed.eps1

        if (
          !sourceFreeTime &&
          (!Number.isFinite(sourceFixedTime) || sourceFixedTime <= 0)
        ) {
          throw new Error(
            'Source homoclinic branch is missing fixed time metadata. Recompute the source branch with the current build and retry Method 2.'
          )
        }
        if (
          !sourceFreeEps0 &&
          (!Number.isFinite(sourceFixedEps0) || sourceFixedEps0 <= 0)
        ) {
          throw new Error(
            'Source homoclinic branch is missing fixed eps0 metadata. Recompute the source branch with the current build and retry Method 2.'
          )
        }
        if (
          !sourceFreeEps1 &&
          (!Number.isFinite(sourceFixedEps1) || sourceFixedEps1 <= 0)
        ) {
          throw new Error(
            'Source homoclinic branch is missing fixed eps1 metadata. Recompute the source branch with the current build and retry Method 2.'
          )
        }

        const branchData = await client.runHomoclinicFromHomoclinic(
          {
            system: runConfig,
            pointState: seedState,
            sourceNtst: sourceType.ntst,
            sourceNcol: sourceType.ncol,
            sourceFreeTime,
            sourceFreeEps0,
            sourceFreeEps1,
            sourceFixedTime: Number.isFinite(sourceFixedTime) ? sourceFixedTime : 1.0,
            sourceFixedEps0,
            sourceFixedEps1,
            parameterName: param1Name,
            param2Name,
            targetNtst: Math.round(request.targetNtst),
            targetNcol: Math.round(request.targetNcol),
            freeTime: request.freeTime,
            freeEps0: request.freeEps0,
            freeEps1: request.freeEps1,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Homoclinic', progress },
              }),
          }
        )

        if (branchData.points.length <= 1) {
          throw new Error(
            'Homoclinic continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const indices =
          branchData.indices && branchData.indices.length === branchData.points.length
            ? branchData.indices
            : branchData.points.map((_, index) => index)

        const normalized = ensureHomoclinicEndpointResumeSeeds(
          normalizeBranchEigenvalues(
          {
            ...branchData,
            indices,
            branch_type:
              branchData.branch_type ?? {
                type: 'HomoclinicCurve' as const,
                ntst: Math.round(request.targetNtst),
                ncol: Math.round(request.targetNcol),
                param1_name: param1DisplayName,
                param2_name: param2DisplayName,
                param1_ref: param1Ref,
                param2_ref: param2Ref,
                free_time: request.freeTime,
                free_eps0: request.freeEps0,
                free_eps1: request.freeEps1,
              },
          },
          { stateDimension: snapshot.freeVariableNames.length }
        ))

        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: `${param1DisplayName}, ${param2DisplayName}`,
          parameterRef: param1Ref,
          parameter2Ref: param2Ref,
          parentObject: sourceBranch.parentObject,
          startObject: sourceBranch.name,
          branchType: 'homoclinic_curve',
          data: normalized,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          subsystemSnapshot: snapshot,
        }

        const parentNodeId = findObjectIdByName(state.system, sourceBranch.parentObject)
        if (!parentNodeId) {
          throw new Error('Unable to locate the parent object in the tree.')
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const selected = selectNode(created.system, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createHomotopySaddleFromEquilibrium = useCallback(
    async (request: HomotopySaddleFromEquilibriumRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const equilibriumLabelLower = formatEquilibriumLabel(system.type, { lowercase: true })
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type === 'map') {
          throw new Error('Homotopy-saddle continuation is only available for flow systems.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'equilibrium') {
          throw new Error(
            `Homotopy-saddle continuation is only available for ${equilibriumLabelLower} branches.`
          )
        }

        const point = sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, sourceBranch.parentObject, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }

        const sourceObjectId = findObjectIdByName(state.system, sourceBranch.parentObject)
        const sourceObjectCandidate = sourceObjectId ? state.system.objects[sourceObjectId] : undefined
        const sourceObject = isFreezableObject(sourceObjectCandidate) ? sourceObjectCandidate : null
        const snapshot = buildBranchSubsystemSnapshot(system, sourceBranch, sourceObject)
        const param1Ref = parseContinuationParameter(system, snapshot, request.parameterName)
        const param2Ref = parseContinuationParameter(system, snapshot, request.param2Name)
        if (formatParameterRefLabel(param2Ref) === formatParameterRefLabel(param1Ref)) {
          throw new Error('Second parameter must be different from the continuation parameter.')
        }
        const param1Name = resolveRuntimeParameterName(snapshot, param1Ref)
        const param2Name = resolveRuntimeParameterName(snapshot, param2Ref)
        const param1DisplayName = resolveDisplayParameterName(param1Ref)
        const param2DisplayName = resolveDisplayParameterName(param2Ref)

        if (!Number.isFinite(request.ntst) || request.ntst < 2 || !Number.isInteger(request.ntst)) {
          throw new Error('NTST must be an integer greater than or equal to 2.')
        }
        if (!Number.isFinite(request.ncol) || request.ncol < 1 || !Number.isInteger(request.ncol)) {
          throw new Error('NCOL must be a positive integer.')
        }
        if (!Number.isFinite(request.eps0) || request.eps0 <= 0) {
          throw new Error('eps0 must be a positive number.')
        }
        if (!Number.isFinite(request.eps1) || request.eps1 <= 0) {
          throw new Error('eps1 must be a positive number.')
        }
        if (!Number.isFinite(request.time) || request.time <= 0) {
          throw new Error('T must be a positive number.')
        }
        if (!Number.isFinite(request.eps1Tol) || request.eps1Tol <= 0) {
          throw new Error('eps1 tolerance must be a positive number.')
        }

        const baseParams = getBranchParams(state.system, sourceBranch)
        let runConfig = buildReducedRunConfig(system, snapshot, baseParams)
        runConfig = applyReducedParamOverrides(runConfig, {
          [param1Name]: point.param_value,
        })
        runConfig = applyReducedParamOverrides(
          runConfig,
          resolveBranchPointReducedParamOverrides(sourceBranch, point)
        )

        const branchData = await client.runHomotopySaddleFromEquilibrium(
          {
            system: runConfig,
            equilibriumState: projectStateForSnapshot(snapshot, point.state, 'Equilibrium point'),
            parameterName: param1Name,
            param2Name,
            ntst: Math.round(request.ntst),
            ncol: Math.round(request.ncol),
            eps0: request.eps0,
            eps1: request.eps1,
            time: request.time,
            eps1Tol: request.eps1Tol,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Homotopy-Saddle', progress },
              }),
          }
        )

        if (branchData.points.length <= 1) {
          throw new Error(
            'Homotopy-saddle continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const indices =
          branchData.indices && branchData.indices.length === branchData.points.length
            ? branchData.indices
            : branchData.points.map((_, index) => index)

        const normalized = ensureHomoclinicEndpointResumeSeeds(
          normalizeBranchEigenvalues(
          {
            ...branchData,
            indices,
            branch_type:
              branchData.branch_type ?? {
                type: 'HomotopySaddleCurve' as const,
                ntst: Math.round(request.ntst),
                ncol: Math.round(request.ncol),
                param1_name: param1DisplayName,
                param2_name: param2DisplayName,
                param1_ref: param1Ref,
                param2_ref: param2Ref,
                stage: 'StageD' as const,
              },
          },
          { stateDimension: snapshot.freeVariableNames.length }
        ))

        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: `${param1DisplayName}, ${param2DisplayName}`,
          parameterRef: param1Ref,
          parameter2Ref: param2Ref,
          parentObject: sourceBranch.parentObject,
          startObject: sourceBranch.name,
          branchType: 'homotopy_saddle_curve',
          data: normalized,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          mapIterations: sourceBranch.mapIterations,
          subsystemSnapshot: snapshot,
        }

        const parentNodeId = findObjectIdByName(state.system, sourceBranch.parentObject)
        if (!parentNodeId) {
          throw new Error(`Unable to locate the parent ${equilibriumLabelLower} in the tree.`)
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const selected = selectNode(created.system, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const createHomoclinicFromHomotopySaddle = useCallback(
    async (request: HomoclinicFromHomotopySaddleRequest) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
      try {
        const system = state.system.config
        const validation = validateSystemConfig(system)
        if (!validation.valid) {
          throw new Error('System settings are invalid.')
        }
        if (system.type === 'map') {
          throw new Error('Homoclinic continuation is only available for flow systems.')
        }

        const sourceBranch = state.system.branches[request.branchId]
        if (!sourceBranch) {
          throw new Error('Select a valid branch to continue.')
        }
        if (sourceBranch.branchType !== 'homotopy_saddle_curve') {
          throw new Error(
            'Homoclinic initialization from homotopy-saddle requires a homotopy-saddle branch.'
          )
        }

        const point = sourceBranch.data.points[request.pointIndex]
        if (!point) {
          throw new Error('Select a valid branch point.')
        }

        const sourceType = sourceBranch.data.branch_type
        if (!sourceType || sourceType.type !== 'HomotopySaddleCurve') {
          throw new Error('Source homotopy-saddle branch is missing metadata.')
        }
        if (sourceType.stage !== 'StageD') {
          throw new Error('Method 3 initialization requires a StageD homotopy-saddle branch.')
        }

        const name = request.name.trim()
        const nameError = validateBranchName(name)
        if (nameError) {
          throw new Error(nameError)
        }
        if (branchNameExists(state.system, sourceBranch.parentObject, name)) {
          throw new Error(`Branch "${name}" already exists.`)
        }

        if (
          !Number.isFinite(request.targetNtst) ||
          request.targetNtst < 2 ||
          !Number.isInteger(request.targetNtst)
        ) {
          throw new Error('Target NTST must be an integer greater than or equal to 2.')
        }
        if (
          !Number.isFinite(request.targetNcol) ||
          request.targetNcol < 1 ||
          !Number.isInteger(request.targetNcol)
        ) {
          throw new Error('Target NCOL must be a positive integer.')
        }
        if (!request.freeTime && !request.freeEps0 && !request.freeEps1) {
          throw new Error('At least one of T, eps0, or eps1 must be free.')
        }

        const sourceObjectId = findObjectIdByName(state.system, sourceBranch.parentObject)
        const sourceObjectCandidate = sourceObjectId ? state.system.objects[sourceObjectId] : undefined
        const sourceObject = isFreezableObject(sourceObjectCandidate) ? sourceObjectCandidate : null
        const snapshot = buildBranchSubsystemSnapshot(system, sourceBranch, sourceObject)
        const param1Ref =
          sourceType.param1_ref ??
          parseContinuationParameter(system, snapshot, sourceType.param1_name)
        const param2Ref =
          sourceType.param2_ref ??
          parseContinuationParameter(system, snapshot, sourceType.param2_name)
        const param1Name = resolveRuntimeParameterName(snapshot, param1Ref)
        const param2Name = resolveRuntimeParameterName(snapshot, param2Ref)
        const param1DisplayName = resolveDisplayParameterName(param1Ref)
        const param2DisplayName = resolveDisplayParameterName(param2Ref)
        const baseParams = getBranchParams(state.system, sourceBranch)
        let runConfig = buildReducedRunConfig(system, snapshot, baseParams)
        runConfig = applyReducedParamOverrides(runConfig, {
          [param1Name]: point.param_value,
        })
        runConfig = applyReducedParamOverrides(
          runConfig,
          resolveBranchPointReducedParamOverrides(sourceBranch, point)
        )

        const branchData = await client.runHomoclinicFromHomotopySaddle(
          {
            system: runConfig,
            stageDState: projectStateForSnapshot(snapshot, point.state, 'StageD point'),
            sourceNtst: sourceType.ntst,
            sourceNcol: sourceType.ncol,
            parameterName: param1Name,
            param2Name,
            targetNtst: Math.round(request.targetNtst),
            targetNcol: Math.round(request.targetNcol),
            freeTime: request.freeTime,
            freeEps0: request.freeEps0,
            freeEps1: request.freeEps1,
            settings: request.settings,
            forward: request.forward,
          },
          {
            onProgress: (progress) =>
              dispatch({
                type: 'SET_CONTINUATION_PROGRESS',
                progress: { label: 'Homoclinic', progress },
              }),
          }
        )

        if (branchData.points.length <= 1) {
          throw new Error(
            'Homoclinic continuation stopped at the seed point. Try a smaller step size or adjust parameters.'
          )
        }

        const indices =
          branchData.indices && branchData.indices.length === branchData.points.length
            ? branchData.indices
            : branchData.points.map((_, index) => index)

        const normalized = normalizeBranchEigenvalues(
          {
            ...branchData,
            indices,
            branch_type:
              branchData.branch_type ?? {
                type: 'HomoclinicCurve' as const,
                ntst: Math.round(request.targetNtst),
                ncol: Math.round(request.targetNcol),
                param1_name: param1DisplayName,
                param2_name: param2DisplayName,
                param1_ref: param1Ref,
                param2_ref: param2Ref,
                free_time: request.freeTime,
                free_eps0: request.freeEps0,
                free_eps1: request.freeEps1,
              },
          },
          { stateDimension: snapshot.freeVariableNames.length }
        )

        const branch: ContinuationObject = {
          type: 'continuation',
          name,
          systemName: system.name,
          parameterName: `${param1DisplayName}, ${param2DisplayName}`,
          parameterRef: param1Ref,
          parameter2Ref: param2Ref,
          parentObject: sourceBranch.parentObject,
          startObject: sourceBranch.name,
          branchType: 'homoclinic_curve',
          data: normalized,
          settings: request.settings,
          timestamp: new Date().toISOString(),
          params: [...baseParams],
          subsystemSnapshot: snapshot,
        }

        const parentNodeId = findObjectIdByName(state.system, sourceBranch.parentObject)
        if (!parentNodeId) {
          throw new Error('Unable to locate the parent object in the tree.')
        }

        const created = addBranch(state.system, branch, parentNodeId)
        const selected = selectNode(created.system, created.nodeId)
        dispatch({ type: 'SET_SYSTEM', system: selected })
        await store.save(selected)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_CONTINUATION_PROGRESS', progress: null })
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [client, state.system, store]
  )

  const addSceneAction = useCallback(
    async (name: string, targetId?: string | null) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const trimmedName = name.trim()
        const nameError = validateObjectName(trimmedName, 'Scene')
        if (nameError) {
          throw new Error(nameError)
        }
        const created = addScene(state.system, trimmedName)
        const updated =
          targetId && targetId !== created.nodeId
            ? reorderNode(created.system, created.nodeId, targetId)
            : created.system
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.saveUi(updated)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const addBifurcationDiagramAction = useCallback(
    async (name: string, targetId?: string | null) => {
      if (!state.system) return
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const trimmedName = name.trim()
        const nameError = validateObjectName(trimmedName, 'Bifurcation diagram')
        if (nameError) {
          throw new Error(nameError)
        }
        const created = addBifurcationDiagram(state.system, trimmedName)
        const updated =
          targetId && targetId !== created.nodeId
            ? reorderNode(created.system, created.nodeId, targetId)
            : created.system
        dispatch({ type: 'SET_SYSTEM', system: updated })
        await store.saveUi(updated)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: message })
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [state.system, store]
  )

  const importSystem = useCallback(
    async (file: File) => {
      dispatch({ type: 'SET_BUSY', busy: true })
      try {
        const system = await readSystemFile(file)
        await store.save(system)
        dispatch({ type: 'SET_SYSTEM', system })
        await refreshSystems()
      } finally {
        dispatch({ type: 'SET_BUSY', busy: false })
      }
    },
    [refreshSystems, store]
  )

  const actions: AppActions = useMemo(
    () => ({
      refreshSystems,
      createSystem: createSystemAction,
      openSystem,
      saveSystem,
      exportSystem,
      deleteSystem,
      resetFork,
      updateSystem: updateSystemAction,
      validateSystem: validateSystemAction,
      selectNode: selectNodeAction,
      renameNode: renameNodeAction,
      toggleVisibility: toggleVisibilityAction,
      toggleExpanded: toggleExpandedAction,
      moveNode: moveNodeAction,
      reorderNode: reorderNodeAction,
      updateLayout: updateLayoutAction,
      updateViewportHeight: updateViewportHeightAction,
      updateRender: updateRenderAction,
      updateObjectParams: updateObjectParamsAction,
      updateObjectFrozenVariables: updateObjectFrozenVariablesAction,
      updateIsoclineObject: updateIsoclineObjectAction,
      updateScene: updateSceneAction,
      updateBifurcationDiagram: updateBifurcationDiagramAction,
      setLimitCycleRenderTarget: setLimitCycleRenderTargetAction,
      deleteNode: deleteNodeAction,
      createOrbitObject,
      createEquilibriumObject,
      createIsoclineObject,
      runOrbit,
      computeIsocline,
      sampleMap1DFunction,
      computeLyapunovExponents,
      computeCovariantLyapunovVectors,
      solveEquilibrium,
      createEquilibriumBranch,
      createBranchFromPoint,
      extendBranch,
      createFoldCurveFromPoint,
      createHopfCurveFromPoint,
      createIsochroneCurveFromPoint,
      createNSCurveFromPoint,
      createLimitCycleFromOrbit,
      createLimitCycleFromHopf,
      createCycleFromPD,
      createLimitCycleFromPD,
      createHomoclinicFromLargeCycle,
      createHomoclinicFromHomoclinic,
      createHomotopySaddleFromEquilibrium,
      createHomoclinicFromHomotopySaddle,
      addScene: addSceneAction,
      addBifurcationDiagram: addBifurcationDiagramAction,
      importSystem,
      clearError: () => dispatch({ type: 'SET_ERROR', error: null }),
    }),
    [
      createEquilibriumObject,
      createOrbitObject,
      runOrbit,
      sampleMap1DFunction,
      computeLyapunovExponents,
      computeCovariantLyapunovVectors,
      solveEquilibrium,
      createEquilibriumBranch,
      createBranchFromPoint,
      extendBranch,
      createFoldCurveFromPoint,
      createHopfCurveFromPoint,
      createIsochroneCurveFromPoint,
      createNSCurveFromPoint,
      createLimitCycleFromHopf,
      createLimitCycleFromOrbit,
      createCycleFromPD,
      createLimitCycleFromPD,
      createHomoclinicFromLargeCycle,
      createHomoclinicFromHomoclinic,
      createHomotopySaddleFromEquilibrium,
      createHomoclinicFromHomotopySaddle,
      addBifurcationDiagramAction,
      createSystemAction,
      deleteSystem,
      resetFork,
      openSystem,
      refreshSystems,
      renameNodeAction,
      saveSystem,
      exportSystem,
      updateSystemAction,
      validateSystemAction,
      selectNodeAction,
      toggleExpandedAction,
      toggleVisibilityAction,
      moveNodeAction,
      reorderNodeAction,
      updateLayoutAction,
      updateViewportHeightAction,
      updateRenderAction,
      updateObjectParamsAction,
      updateObjectFrozenVariablesAction,
      updateIsoclineObjectAction,
      updateSceneAction,
      updateBifurcationDiagramAction,
      setLimitCycleRenderTargetAction,
      deleteNodeAction,
      createIsoclineObject,
      computeIsocline,
      addSceneAction,
      importSystem,
    ]
  )

  return (
    <AppContext.Provider
      value={{
        state,
        actions,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}
