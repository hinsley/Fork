export type StepSizeDraft = {
  stepSize: string
  minStepSize: string
  maxStepSize: string
}

export type StepSizeIssues = {
  stepSize: boolean
  minStepSize: boolean
  maxStepSize: boolean
  /** First problem, shown inline; null when the step sizes are consistent. */
  message: string | null
  invalid: boolean
}

function parse(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Cross-field check for continuation step sizes: the initial step and the min
 * step must not exceed the max step (the solver would silently clamp them).
 * Unparseable values are left to the submit-time checks.
 */
export function validateStepSizes(draft: StepSizeDraft): StepSizeIssues {
  const step = parse(draft.stepSize)
  const min = parse(draft.minStepSize)
  const max = parse(draft.maxStepSize)
  const stepTooLarge = step !== null && max !== null && step > max
  const minTooLarge = min !== null && max !== null && min > max
  const message = stepTooLarge
    ? 'Initial step exceeds max step.'
    : minTooLarge
      ? 'Min step exceeds max step.'
      : null
  return {
    stepSize: stepTooLarge,
    minStepSize: minTooLarge,
    maxStepSize: stepTooLarge || minTooLarge,
    message,
    invalid: message !== null,
  }
}
