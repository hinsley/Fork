import type { SystemConfig } from '../../system/types'
import { normalizePeriodicVariables } from '../../system/periodicity'
import { normalizePeriodicForcing } from '../../system/forcing'

function sameList<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
}

function resolvedSolver(config: SystemConfig): string {
  return config.type === 'map' ? 'discrete' : config.solver
}

/**
 * Field-by-field comparison of the settings the System editor owns.
 *
 * Must not depend on object key order: stored configs and editor drafts are
 * built with different key orders (JSON.stringify comparisons reported every
 * freshly opened dialog as "dirty").
 */
export function systemConfigsEqual(left: SystemConfig, right: SystemConfig): boolean {
  if (left.name !== right.name) return false
  if (left.type !== right.type) return false
  if (resolvedSolver(left) !== resolvedSolver(right)) return false
  if (!sameList(left.varNames, right.varNames)) return false
  if (!sameList(left.equations, right.equations)) return false
  if (!sameList(left.paramNames, right.paramNames)) return false
  if (!sameList(left.params, right.params)) return false

  const leftPeriodic = normalizePeriodicVariables(left)
  const rightPeriodic = normalizePeriodicVariables(right)
  if (leftPeriodic.length !== rightPeriodic.length) return false
  for (let index = 0; index < leftPeriodic.length; index += 1) {
    const a = leftPeriodic[index]
    const b = rightPeriodic[index]
    if (Boolean(a?.enabled) !== Boolean(b?.enabled)) return false
    if (!a?.enabled) continue
    // Compare the raw period so an invalid (NaN) draft period still counts as a change.
    const rawA = left.periodicVariables?.[index]?.period ?? a.period
    const rawB = right.periodicVariables?.[index]?.period ?? b?.period
    if (!Object.is(rawA, rawB)) return false
  }

  const leftForcing = normalizePeriodicForcing(left)
  const rightForcing = normalizePeriodicForcing(right)
  if (!leftForcing || !rightForcing) return !leftForcing && !rightForcing
  if (leftForcing.symbol !== rightForcing.symbol) return false
  if (leftForcing.symbol === 't' && rightForcing.symbol === 't') {
    return leftForcing.periodExpression === rightForcing.periodExpression
  }
  if (leftForcing.symbol === 'n' && rightForcing.symbol === 'n') {
    return leftForcing.iterationPeriod === rightForcing.iterationPeriod
  }
  return false
}
