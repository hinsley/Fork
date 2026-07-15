import type {
  FrozenEquationContext,
  SystemConfig,
} from './types';

type ContextCarrier = { frozenEquationContext?: FrozenEquationContext };

const IDENTIFIER_PATTERN = /[a-zA-Z_][a-zA-Z0-9_]*/g;

export function equationContextSymbol(system: Pick<SystemConfig, 'type'>): 't' | 'n' {
  return system.type === 'map' ? 'n' : 't';
}

export function usesEquationContext(
  system: Pick<SystemConfig, 'type' | 'equations' | 'varNames' | 'paramNames'>
): boolean {
  const symbol = equationContextSymbol(system);
  if (system.varNames.includes(symbol) || system.paramNames.includes(symbol)) return false;
  return system.equations.some((equation) =>
    (equation.match(IDENTIFIER_PATTERN) ?? []).some((token) => token === symbol)
  );
}

export function normalizeFrozenEquationContext(
  system: SystemConfig,
  context?: FrozenEquationContext | null
): FrozenEquationContext | undefined {
  if (!context || !usesEquationContext(system)) return undefined;
  const symbol = equationContextSymbol(system);
  if (context.symbol !== symbol || !Number.isFinite(context.value)) return undefined;
  if (symbol === 'n' && !Number.isSafeInteger(context.value)) return undefined;
  return { symbol, value: context.value };
}

function replaceIdentifier(expression: string, identifier: string, replacement: string): string {
  return expression.replace(IDENTIFIER_PATTERN, (token) =>
    token === identifier ? replacement : token
  );
}

function generatedContextParameterName(system: SystemConfig, symbol: 't' | 'n'): string {
  const occupied = new Set(system.paramNames);
  const base = `fc__${symbol}`;
  if (!occupied.has(base)) return base;
  let suffix = 1;
  while (occupied.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

export function configForObject(
  system: SystemConfig,
  object?: ContextCarrier | null
): SystemConfig {
  const context = normalizeFrozenEquationContext(system, object?.frozenEquationContext);
  if (!context) return { ...system, params: [...system.params] };
  const generated = generatedContextParameterName(system, context.symbol);
  return {
    ...system,
    equations: system.equations.map((equation) =>
      replaceIdentifier(equation, context.symbol, generated)
    ),
    params: [...system.params, context.value],
    paramNames: [...system.paramNames, generated],
  };
}

export function autonomousContextError(
  system: SystemConfig,
  object?: ContextCarrier | null
): string | null {
  if (!usesEquationContext(system)) return null;
  if (normalizeFrozenEquationContext(system, object?.frozenEquationContext)) return null;
  const symbol = equationContextSymbol(system);
  return `This system depends on ${symbol}. Freeze the equation forcing context before running autonomous analysis.`;
}
