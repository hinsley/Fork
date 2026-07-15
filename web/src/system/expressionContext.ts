import type {
  EquationContextSymbol,
  FrozenEquationContext,
  SystemConfig,
} from './types'

const IDENTIFIER_PATTERN = /[a-zA-Z_][a-zA-Z0-9_]*/g

export function equationContextSymbol(
  system: Pick<SystemConfig, 'type'>
): EquationContextSymbol {
  return system.type === 'map' ? 'n' : 't'
}

export function usesEquationContext(
  system: Pick<SystemConfig, 'type' | 'equations' | 'varNames' | 'paramNames'>
): boolean {
  const symbol = equationContextSymbol(system)
  if (
    system.varNames.some((name) => name === symbol) ||
    system.paramNames.some((name) => name === symbol)
  ) {
    return false
  }
  return system.equations.some((equation) =>
    (equation.match(IDENTIFIER_PATTERN) ?? []).some((token) => token === symbol)
  )
}

export function normalizeFrozenEquationContext(
  system: Pick<SystemConfig, 'type' | 'equations' | 'varNames' | 'paramNames'>,
  context?: FrozenEquationContext | null
): FrozenEquationContext | undefined {
  if (!context || !usesEquationContext(system)) return undefined
  const symbol = equationContextSymbol(system)
  if (context.symbol !== symbol || !Number.isFinite(context.value)) return undefined
  if (symbol === 'n' && !Number.isSafeInteger(context.value)) return undefined
  return { symbol, value: context.value }
}

export function autonomousContextError(
  system: Pick<SystemConfig, 'type' | 'equations' | 'varNames' | 'paramNames'>,
  frozen?: FrozenEquationContext | null
): string | null {
  if (!usesEquationContext(system)) return null
  if (normalizeFrozenEquationContext(system, frozen)) return null
  const symbol = equationContextSymbol(system)
  return `This system depends on ${symbol}. Freeze the equation forcing context before running autonomous analysis.`
}
