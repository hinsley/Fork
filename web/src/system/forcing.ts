import type { PeriodicForcingConfig, SystemConfig } from './types'

export function normalizePeriodicForcing(
  config: Pick<SystemConfig, 'type' | 'periodicForcing'>
): PeriodicForcingConfig | undefined {
  const forcing = config.periodicForcing
  if (!forcing) return undefined
  if (config.type === 'flow' && forcing.symbol === 't') {
    return { symbol: 't', periodExpression: String(forcing.periodExpression ?? '') }
  }
  if (config.type === 'map' && forcing.symbol === 'n') {
    return { symbol: 'n', iterationPeriod: Number(forcing.iterationPeriod) }
  }
  return undefined
}

export function forcingDeclarationError(
  config: Pick<
    SystemConfig,
    'type' | 'equations' | 'varNames' | 'paramNames' | 'periodicForcing'
  >,
  usesContext: boolean
): string | null {
  const forcing = normalizePeriodicForcing(config)
  if (!config.periodicForcing) return null
  if (!forcing) {
    return `Periodic forcing must declare ${config.type === 'flow' ? 't' : 'n'} for this system type.`
  }
  if (!usesContext) {
    return 'Periodic forcing can only be declared when equations use the contextual t/n symbol.'
  }
  if (forcing.symbol === 't') {
    if (!forcing.periodExpression.trim()) return 'Forcing period expression is required.'
  } else if (!Number.isSafeInteger(forcing.iterationPeriod) || forcing.iterationPeriod <= 0) {
    return 'Map forcing period must be a positive safe integer.'
  }
  return null
}
