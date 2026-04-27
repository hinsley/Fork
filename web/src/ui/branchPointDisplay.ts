import type { ContinuationObject, ContinuationPoint, SystemConfig } from '../system/types'
import {
  normalizeEigenvalueArray,
  resolveContinuationPointParam2Value,
} from '../system/continuation'
import { formatParameterRefLabel } from '../system/subsystemGateway'

export type ContinuationParameterReadout = {
  label: string
  value: string
}

export type Codim1ParamNames = {
  param1: string
  param2: string
}

export function formatContinuationDisplayNumber(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return 'n/a'
  return value.toPrecision(digits)
}

function formatContinuationDisplayNumberSafe(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'NaN'
  return formatContinuationDisplayNumber(value)
}

export function resolveCodim1ParamNames(
  branch?: ContinuationObject | null
): Codim1ParamNames | null {
  const branchType = branch?.data.branch_type
  if (!branchType || typeof branchType !== 'object') return null
  if ('param1_name' in branchType && 'param2_name' in branchType) {
    return { param1: branchType.param1_name, param2: branchType.param2_name }
  }
  return null
}

function parseContinuationParameterNameParts(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

export function resolveContinuationParameterReadout(
  systemConfig: Pick<SystemConfig, 'paramNames'>,
  branchParams: number[],
  branch: ContinuationObject,
  point: ContinuationPoint,
  stateDimension: number
): ContinuationParameterReadout | null {
  const branchType = branch.data.branch_type
  const codim1ParamNames = resolveCodim1ParamNames(branch)
  const parameterNameParts = parseContinuationParameterNameParts(branch.parameterName)
  const branchTypeParam1Ref =
    branchType && typeof branchType === 'object' && 'param1_ref' in branchType
      ? branchType.param1_ref
      : undefined
  const branchTypeParam2Ref =
    branchType && typeof branchType === 'object' && 'param2_ref' in branchType
      ? branchType.param2_ref
      : undefined

  const primaryLabel =
    codim1ParamNames?.param1.trim() ||
    (branchTypeParam1Ref ? formatParameterRefLabel(branchTypeParam1Ref) : null) ||
    (branch.parameterRef ? formatParameterRefLabel(branch.parameterRef) : null) ||
    parameterNameParts[0] ||
    branch.parameterName.trim() ||
    'parameter'
  const secondaryLabel =
    codim1ParamNames?.param2.trim() ||
    (branchTypeParam2Ref ? formatParameterRefLabel(branchTypeParam2Ref) : null) ||
    (branch.parameter2Ref ? formatParameterRefLabel(branch.parameter2Ref) : null) ||
    parameterNameParts[1] ||
    null

  const resolveNativeParamFallback = (label: string | null): number | undefined => {
    if (!label) return undefined
    const index = systemConfig.paramNames.indexOf(label)
    if (index < 0) return undefined
    const value = branchParams[index]
    return Number.isFinite(value) ? value : undefined
  }

  const entries: string[] = []
  const primaryValue = Number.isFinite(point.param_value)
    ? point.param_value
    : resolveNativeParamFallback(primaryLabel)
  if (Number.isFinite(primaryValue)) {
    entries.push(
      `${primaryLabel}=${formatContinuationDisplayNumber(primaryValue as number, 6)}`
    )
  }

  const inferredSecondaryValue =
    typeof point.param2_value === 'number' && Number.isFinite(point.param2_value)
      ? point.param2_value
      : resolveContinuationPointParam2Value(point, branchType, stateDimension)
  const secondaryValue = Number.isFinite(inferredSecondaryValue)
    ? inferredSecondaryValue
    : resolveNativeParamFallback(secondaryLabel)
  if (
    secondaryLabel &&
    secondaryLabel !== primaryLabel &&
    Number.isFinite(secondaryValue)
  ) {
    entries.push(
      `${secondaryLabel}=${formatContinuationDisplayNumber(secondaryValue as number, 6)}`
    )
  }

  if (entries.length === 0) return null
  return {
    label: entries.length === 1 ? 'Continuation parameter' : 'Continuation parameters',
    value: entries.join(', '),
  }
}

export function resolveBranchPointParams(
  paramNames: string[],
  baseParams: number[],
  branch: ContinuationObject,
  point: ContinuationPoint,
  stateDimension: number
): number[] {
  if (paramNames.length === 0) return []
  const codim1ParamNames = resolveCodim1ParamNames(branch)
  const continuationParamIndex = paramNames.indexOf(branch.parameterName)
  return paramNames.map((name, index) => {
    let value = baseParams[index]
    if (codim1ParamNames) {
      if (name === codim1ParamNames.param1) {
        value = point.param_value
      } else if (name === codim1ParamNames.param2) {
        value =
          resolveContinuationPointParam2Value(
            point,
            branch.data.branch_type,
            stateDimension
          ) ?? baseParams[index]
      }
    } else if (index === continuationParamIndex) {
      value = point.param_value
    }
    return value ?? Number.NaN
  })
}

export function summarizeContinuationPointEigenvalues(
  point: ContinuationPoint,
  branchType?: string
): string {
  const eigenvalues = normalizeEigenvalueArray(point.eigenvalues)
  const label =
    branchType === 'limit_cycle' ||
    branchType === 'isochrone_curve' ||
    branchType === 'lpc_curve' ||
    branchType === 'pd_curve' ||
    branchType === 'ns_curve'
      ? 'Multipliers'
      : 'Eigenvalues'
  if (eigenvalues.length === 0) return `${label}: []`
  const formatted = eigenvalues
    .slice(0, 3)
    .map(
      (ev) =>
        `${formatContinuationDisplayNumberSafe(ev.re)}+${formatContinuationDisplayNumberSafe(
          ev.im
        )}i`
    )
  const suffix = eigenvalues.length > 3 ? ' …' : ''
  return `${label}: ${formatted.join(', ')}${suffix}`
}
