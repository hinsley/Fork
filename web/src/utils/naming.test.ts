import { describe, it, expect } from 'vitest'
import { isCliSafeName, toCliSafeName } from './naming'

describe('naming utils', () => {
  it('validates CLI-safe names', () => {
    expect(isCliSafeName('Alpha_123')).toBe(true)
    expect(isCliSafeName('')).toBe(false)
    expect(isCliSafeName('bad-name')).toBe(false)
    expect(isCliSafeName('has space')).toBe(false)
  })

  it('normalizes names into CLI-safe slugs', () => {
    expect(toCliSafeName(' Hello   world! ')).toBe('Hello_world_')
    expect(toCliSafeName('a/b\\c')).toBe('a_b_c')
    expect(toCliSafeName('Already_OK')).toBe('Already_OK')
  })

  it('handles whitespace-only input', () => {
    expect(toCliSafeName('   ')).toBe('')
    expect(isCliSafeName(toCliSafeName('   '))).toBe(false)
  })
})
