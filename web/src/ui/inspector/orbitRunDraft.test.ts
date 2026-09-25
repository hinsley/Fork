import { describe, expect, it } from 'vitest'
import { normalizeOrbitDuration } from './orbitRunDraft'

describe('normalizeOrbitDuration', () => {
  it('snaps accumulated rounding to a whole number of steps', () => {
    expect(normalizeOrbitDuration(100.00000000001425, 0.01)).toBe(100)
    expect(normalizeOrbitDuration(0.30000000000000004, 0.1)).toBe(0.3)
    expect(normalizeOrbitDuration(1.0999999999999999, 0.1)).toBe(1.1)
  })

  it('keeps spans that are not a step multiple, trimmed to 12 digits', () => {
    expect(normalizeOrbitDuration(7.25, 0.1)).toBe(7.25)
    expect(normalizeOrbitDuration(1 / 3, 0.01)).toBe(0.333333333333)
  })

  it('leaves integer map spans and invalid values alone', () => {
    expect(normalizeOrbitDuration(1000, 1)).toBe(1000)
    expect(normalizeOrbitDuration(0, 0.01)).toBe(0)
    expect(normalizeOrbitDuration(12.5, undefined)).toBe(12.5)
  })
})
