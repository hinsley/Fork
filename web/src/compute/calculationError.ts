import type { CalculationDiagnostic } from '../system/types'

export function normalizeCalculationDiagnostic(value: unknown): CalculationDiagnostic | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  if (typeof input.kind !== 'string' || typeof input.message !== 'string') return undefined
  const result: CalculationDiagnostic = { kind: input.kind, message: input.message }
  if (typeof input.suggestion === 'string') result.suggestion = input.suggestion
  for (const key of ['iterations', 'max_iterations', 'residual_norm', 'tolerance', 'step_size', 'min_step_size'] as const) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) result[key] = input[key]
  }
  return result
}

export class CalculationError extends Error {
  readonly diagnostic?: CalculationDiagnostic
  constructor(message: string, diagnostic?: CalculationDiagnostic) {
    super(message)
    this.name = 'CalculationError'
    this.diagnostic = diagnostic
  }
}

export function calculationError(value: unknown): Error & { diagnostic?: CalculationDiagnostic } {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new CalculationError(value)
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>
    const diagnostic = normalizeCalculationDiagnostic(input.diagnostic) ?? normalizeCalculationDiagnostic(input)
    const message = typeof input.message === 'string' ? input.message : diagnostic?.message
    if (message) return new CalculationError(message, diagnostic)
  }
  return new CalculationError('Calculation failed without an error description.')
}
