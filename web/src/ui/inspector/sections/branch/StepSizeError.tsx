import type { StepSizeIssues } from './stepSizeValidation'

/** Inline message for inconsistent continuation step sizes. */
export function StepSizeError({
  issues,
  testId,
}: {
  issues: StepSizeIssues
  testId: string
}) {
  if (!issues.message) return null
  return (
    <div className="field-error" role="alert" data-testid={testId}>
      {issues.message}
    </div>
  )
}
