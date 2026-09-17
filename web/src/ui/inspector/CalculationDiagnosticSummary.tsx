import type { CalculationDiagnostic } from '../../system/types'

export function CalculationDiagnosticSummary({
  diagnostic,
  partial = false,
}: {
  diagnostic: CalculationDiagnostic
  partial?: boolean
}) {
  const finite = (value: number | undefined): value is number =>
    value !== undefined && Number.isFinite(value)
  const metrics: string[] = []
  if (finite(diagnostic.iterations)) {
    metrics.push(`Iterations ${diagnostic.iterations}${finite(diagnostic.max_iterations) ? ` / ${diagnostic.max_iterations}` : ''}`)
  }
  if (finite(diagnostic.residual_norm)) {
    metrics.push(`Residual ${diagnostic.residual_norm.toExponential(2)}`)
  }
  if (finite(diagnostic.tolerance)) {
    metrics.push(`Tolerance ${diagnostic.tolerance.toExponential(2)}`)
  }
  if (finite(diagnostic.step_size)) {
    metrics.push(`Step ${diagnostic.step_size.toExponential(2)}`)
  }
  if (finite(diagnostic.min_step_size)) {
    metrics.push(`Minimum step ${diagnostic.min_step_size.toExponential(2)}`)
  }
  return (
    <div className={partial ? 'field-warning' : 'field-error'} role="status" data-testid="calculation-diagnostic">
      {partial ? <strong>Stopped early · accepted points retained</strong> : null}
      <p>{diagnostic.message}</p>
      {metrics.length > 0 ? <p data-testid="calculation-diagnostic-metrics">{metrics.join(' · ')}</p> : null}
      {diagnostic.suggestion ? <p>{diagnostic.suggestion}</p> : null}
    </div>
  )
}
