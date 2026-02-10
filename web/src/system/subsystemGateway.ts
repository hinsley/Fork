import type {
  FrozenVariablesConfig,
  ParameterRef,
  SubsystemSnapshot,
  SystemConfig,
} from './types'

export const FROZEN_VARIABLE_LABEL_PREFIX = 'var:'
export const FROZEN_PARAMETER_PREFIX = 'fv__'

type FrozenVariableOptions = {
  maxFreeVariables?: number
  requireAtLeastOneFree?: boolean
}

type FrozenStateProjectionOptions = {
  parameterRef?: ParameterRef | null
  paramValue?: number | null
  parameter2Ref?: ParameterRef | null
  param2Value?: number | null
}

export type ContinuationParameterOption = {
  ref: ParameterRef
  label: string
}

type FrozenVariablesCarrier = {
  frozenVariables?: FrozenVariablesConfig
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceIdentifier(expr: string, identifier: string, replacement: string): string {
  if (!identifier) return expr
  const pattern = new RegExp(`\\b${escapeRegex(identifier)}\\b`, 'g')
  return expr.replace(pattern, replacement)
}

function normalizeNumeric(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stableHash(value: unknown): string {
  const json = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `ss:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function ensureSnapshotForSystem(system: SystemConfig, snapshot: SubsystemSnapshot): void {
  if (
    snapshot.baseVarNames.length !== system.varNames.length ||
    snapshot.baseVarNames.some((name, index) => name !== system.varNames[index])
  ) {
    throw new Error('Subsystem snapshot is incompatible with current system variables.')
  }
  if (
    snapshot.baseParamNames.length !== system.paramNames.length ||
    snapshot.baseParamNames.some((name, index) => name !== system.paramNames[index])
  ) {
    throw new Error('Subsystem snapshot is incompatible with current system parameters.')
  }
}

function normalizeFrozenMap(
  system: SystemConfig,
  frozenConfig?: FrozenVariablesConfig | null
): Record<string, number> {
  const raw = frozenConfig?.frozenValuesByVarName ?? {}
  const validVarSet = new Set(system.varNames)
  const normalized: Record<string, number> = {}
  for (const name of system.varNames) {
    if (!(name in raw)) continue
    if (!validVarSet.has(name)) continue
    normalized[name] = normalizeNumeric(raw[name], 0)
  }
  return normalized
}

function makeFrozenParamName(
  varName: string,
  occupied: Set<string>
): string {
  const base = `${FROZEN_PARAMETER_PREFIX}${varName}`
  if (!occupied.has(base)) {
    occupied.add(base)
    return base
  }
  let suffix = 1
  while (occupied.has(`${base}_${suffix}`)) {
    suffix += 1
  }
  const candidate = `${base}_${suffix}`
  occupied.add(candidate)
  return candidate
}

export function normalizeFrozenVariablesConfig(
  system: SystemConfig,
  frozenConfig?: FrozenVariablesConfig | null
): FrozenVariablesConfig {
  return {
    frozenValuesByVarName: normalizeFrozenMap(system, frozenConfig),
  }
}

export function buildSubsystemSnapshot(
  system: SystemConfig,
  frozenConfig?: FrozenVariablesConfig | null,
  options?: FrozenVariableOptions
): SubsystemSnapshot {
  const normalized = normalizeFrozenVariablesConfig(system, frozenConfig)
  const frozenValuesByVarName = normalized.frozenValuesByVarName
  const freeVariableNames: string[] = []
  const freeVariableIndices: number[] = []
  const frozenParameterNamesByVarName: Record<string, string> = {}
  const occupied = new Set(system.paramNames)

  for (let index = 0; index < system.varNames.length; index += 1) {
    const varName = system.varNames[index]
    if (Object.prototype.hasOwnProperty.call(frozenValuesByVarName, varName)) {
      frozenParameterNamesByVarName[varName] = makeFrozenParamName(varName, occupied)
      continue
    }
    freeVariableNames.push(varName)
    freeVariableIndices.push(index)
  }

  const requireAtLeastOneFree = options?.requireAtLeastOneFree ?? true
  if (requireAtLeastOneFree && freeVariableNames.length === 0) {
    throw new Error('At least one free variable is required.')
  }
  if (
    Number.isFinite(options?.maxFreeVariables) &&
    options?.maxFreeVariables !== undefined &&
    freeVariableNames.length > options.maxFreeVariables
  ) {
    throw new Error(`At most ${options.maxFreeVariables} free variables are allowed.`)
  }

  const base = {
    baseVarNames: [...system.varNames],
    baseParamNames: [...system.paramNames],
    freeVariableNames,
    freeVariableIndices,
    frozenValuesByVarName,
    frozenParameterNamesByVarName,
  }
  return {
    ...base,
    hash: stableHash(base),
  }
}

export function subsystemSnapshotFromObject(
  system: SystemConfig,
  object: FrozenVariablesCarrier,
  options?: FrozenVariableOptions
): SubsystemSnapshot {
  return buildSubsystemSnapshot(system, object.frozenVariables, options)
}

export function isSubsystemSnapshotCompatible(
  system: SystemConfig,
  snapshot?: SubsystemSnapshot | null
): boolean {
  if (!snapshot) return false
  return (
    snapshot.baseVarNames.length === system.varNames.length &&
    snapshot.baseVarNames.every((name, index) => name === system.varNames[index]) &&
    snapshot.baseParamNames.length === system.paramNames.length &&
    snapshot.baseParamNames.every((name, index) => name === system.paramNames[index])
  )
}

export function resolveSubsystemSnapshot(
  system: SystemConfig,
  preferred?: SubsystemSnapshot | null,
  fallbackFrozenConfig?: FrozenVariablesConfig | null,
  options?: FrozenVariableOptions
): SubsystemSnapshot {
  if (preferred && isSubsystemSnapshotCompatible(system, preferred)) {
    return preferred
  }
  return buildSubsystemSnapshot(system, fallbackFrozenConfig, options)
}

export function buildReducedRunConfig(
  system: SystemConfig,
  snapshot: SubsystemSnapshot,
  parameterValues?: number[]
): SystemConfig {
  ensureSnapshotForSystem(system, snapshot)
  const baseParams =
    Array.isArray(parameterValues) && parameterValues.length === system.params.length
      ? parameterValues
      : system.params
  const appendedParamNames: string[] = []
  const appendedParamValues: number[] = []
  for (const varName of system.varNames) {
    if (!Object.prototype.hasOwnProperty.call(snapshot.frozenValuesByVarName, varName)) continue
    const generated = snapshot.frozenParameterNamesByVarName[varName]
    if (!generated) {
      throw new Error(`Missing generated frozen parameter for variable "${varName}".`)
    }
    appendedParamNames.push(generated)
    appendedParamValues.push(snapshot.frozenValuesByVarName[varName])
  }

  const rewrittenEquations = snapshot.freeVariableIndices.map((baseIndex) => {
    const source = system.equations[baseIndex] ?? ''
    return Object.entries(snapshot.frozenParameterNamesByVarName).reduce(
      (expr, [varName, frozenParamName]) => replaceIdentifier(expr, varName, frozenParamName),
      source
    )
  })

  return {
    ...system,
    equations: rewrittenEquations,
    varNames: [...snapshot.freeVariableNames],
    params: [...baseParams, ...appendedParamValues],
    paramNames: [...system.paramNames, ...appendedParamNames],
  }
}

export function projectStateToReduced(
  snapshot: SubsystemSnapshot,
  fullState: number[]
): number[] {
  if (!Array.isArray(fullState) || fullState.length !== snapshot.baseVarNames.length) {
    throw new Error('State dimension mismatch while projecting to reduced subsystem.')
  }
  return snapshot.freeVariableIndices.map((index) => fullState[index] ?? 0)
}

function applyFrozenParameterRefValue(
  snapshot: SubsystemSnapshot,
  values: number[],
  parameterRef: ParameterRef | null | undefined,
  value: number | null | undefined
): void {
  if (!parameterRef || parameterRef.kind !== 'frozen_var') return
  if (!Number.isFinite(value)) return
  const index = snapshot.baseVarNames.indexOf(parameterRef.variableName)
  if (index < 0 || index >= values.length) return
  values[index] = value as number
}

export function embedReducedStateForDisplay(
  snapshot: SubsystemSnapshot,
  reducedState: number[],
  options?: FrozenStateProjectionOptions
): number[] {
  const full = snapshot.baseVarNames.map(
    (name) => snapshot.frozenValuesByVarName[name] ?? 0
  )
  for (let reducedIndex = 0; reducedIndex < snapshot.freeVariableIndices.length; reducedIndex += 1) {
    const fullIndex = snapshot.freeVariableIndices[reducedIndex]
    if (fullIndex < 0 || fullIndex >= full.length) continue
    const value = reducedState[reducedIndex]
    full[fullIndex] = Number.isFinite(value) ? value : 0
  }
  applyFrozenParameterRefValue(snapshot, full, options?.parameterRef, options?.paramValue)
  applyFrozenParameterRefValue(snapshot, full, options?.parameter2Ref, options?.param2Value)
  return full
}

export function mapStateRowsToReduced(
  snapshot: SubsystemSnapshot,
  rows: number[][]
): number[][] {
  return rows.map((row) => {
    if (!Array.isArray(row) || row.length === 0) return row
    const [time, ...state] = row
    if (state.length !== snapshot.baseVarNames.length) {
      return row
    }
    return [time, ...projectStateToReduced(snapshot, state)]
  })
}

export function mapStateRowsToDisplay(
  snapshot: SubsystemSnapshot,
  rows: number[][],
  options?: FrozenStateProjectionOptions
): number[][] {
  return rows.map((row) => {
    if (!Array.isArray(row) || row.length === 0) return row
    const [time, ...state] = row
    if (state.length === snapshot.baseVarNames.length) {
      return [time, ...state]
    }
    if (state.length !== snapshot.freeVariableNames.length) {
      return row
    }
    return [time, ...embedReducedStateForDisplay(snapshot, state, options)]
  })
}

export function stateVectorToDisplay(
  snapshot: SubsystemSnapshot,
  state: number[],
  options?: FrozenStateProjectionOptions
): number[] {
  if (state.length === snapshot.baseVarNames.length) {
    return [...state]
  }
  if (state.length === snapshot.freeVariableNames.length) {
    return embedReducedStateForDisplay(snapshot, state, options)
  }
  return [...state]
}

export function formatParameterRefLabel(ref: ParameterRef): string {
  if (ref.kind === 'native_param') return ref.name
  return `${FROZEN_VARIABLE_LABEL_PREFIX}${ref.variableName}`
}

export function parseParameterRefLabel(
  system: SystemConfig,
  snapshot: SubsystemSnapshot,
  label: string
): ParameterRef {
  if (label.startsWith(FROZEN_VARIABLE_LABEL_PREFIX)) {
    const variableName = label.slice(FROZEN_VARIABLE_LABEL_PREFIX.length)
    if (
      !variableName ||
      !Object.prototype.hasOwnProperty.call(snapshot.frozenValuesByVarName, variableName)
    ) {
      throw new Error('Select a valid frozen variable.')
    }
    return { kind: 'frozen_var', variableName }
  }
  if (!system.paramNames.includes(label)) {
    throw new Error('Select a valid continuation parameter.')
  }
  return { kind: 'native_param', name: label }
}

export function resolveRuntimeParameterName(
  snapshot: SubsystemSnapshot,
  ref: ParameterRef
): string {
  if (ref.kind === 'native_param') return ref.name
  const generated = snapshot.frozenParameterNamesByVarName[ref.variableName]
  if (!generated) {
    throw new Error(`Frozen variable "${ref.variableName}" is not available in this subsystem.`)
  }
  return generated
}

export function continuationParameterOptions(
  system: SystemConfig,
  snapshot: SubsystemSnapshot
): ContinuationParameterOption[] {
  const native = system.paramNames.map(
    (name): ContinuationParameterOption => ({
      ref: { kind: 'native_param', name },
      label: name,
    })
  )
  const frozen = Object.keys(snapshot.frozenValuesByVarName).map(
    (variableName): ContinuationParameterOption => ({
      ref: { kind: 'frozen_var', variableName },
      label: `${FROZEN_VARIABLE_LABEL_PREFIX}${variableName}`,
    })
  )
  return [...native, ...frozen]
}

export function isVariableFrozen(
  snapshot: SubsystemSnapshot | null | undefined,
  variableName: string
): boolean {
  if (!snapshot) return false
  return Object.prototype.hasOwnProperty.call(snapshot.frozenValuesByVarName, variableName)
}

export function currentSnapshotHashForObject(
  system: SystemConfig,
  object: FrozenVariablesCarrier,
  options?: FrozenVariableOptions
): string {
  return buildSubsystemSnapshot(system, object.frozenVariables, options).hash
}
