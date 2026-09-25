import { describe, expect, it } from 'vitest'
import { calculationError, dedupeCalculationMessage } from './calculationError'

const diagnostic = {
  kind: 'singular_jacobian',
  message: 'Newton solve: Jacobian is singular.',
  suggestion: 'Choose a nearby seed and check equation or variable scaling.',
}

describe('calculation error messages', () => {
  it('drops the root cause anyhow appends after the diagnostic', () => {
    // `format!("{error:#}")` of context("Equilibrium solve failed") → diagnostic → cause.
    const wasmMessage =
      'Equilibrium solve failed: Newton solve: Jacobian is singular. Choose a nearby seed and check equation or variable scaling.: Jacobian is singular.'
    const error = calculationError({ message: wasmMessage, diagnostic })
    expect(error.message).toBe(
      'Equilibrium solve failed: Newton solve: Jacobian is singular. Choose a nearby seed and check equation or variable scaling.'
    )
    expect(error.message.match(/Jacobian is singular/g)).toHaveLength(1)
    // Idempotent when the worker's message is normalized again on the main thread.
    expect(calculationError({ message: error.message, diagnostic }).message).toBe(error.message)
  })

  it('keeps unrelated trailing causes and messages without diagnostics', () => {
    const message =
      'Solve failed: Newton solve: Jacobian is singular. Choose a nearby seed and check equation or variable scaling.: out of memory'
    expect(dedupeCalculationMessage(message, diagnostic)).toBe(message)
    expect(dedupeCalculationMessage('Plain failure: cause', undefined)).toBe(
      'Plain failure: cause'
    )
  })
})
