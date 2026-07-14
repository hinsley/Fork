import { describe, expect, it } from 'vitest'
import {
  homoclinicExtraSelectionError,
  isHomoclinicExtraSelectionDisabled,
} from '../../system/homoclinicExtras'

describe('homoclinic extra selection', () => {
  it('accepts exactly one or two free extras', () => {
    expect(homoclinicExtraSelectionError(false, true, false)).toBeNull()
    expect(homoclinicExtraSelectionError(true, false, true)).toBeNull()
  })

  it('rejects zero or three free extras', () => {
    expect(homoclinicExtraSelectionError(false, false, false)).toMatch(/at least one/i)
    expect(homoclinicExtraSelectionError(true, true, true)).toMatch(/at most two/i)
  })

  it('disables only an unchecked third extra', () => {
    expect(
      isHomoclinicExtraSelectionDisabled(
        { freeTime: false, freeEps0: true, freeEps1: true },
        'freeTime'
      )
    ).toBe(true)
    expect(
      isHomoclinicExtraSelectionDisabled(
        { freeTime: true, freeEps0: true, freeEps1: false },
        'freeEps1'
      )
    ).toBe(true)
    expect(
      isHomoclinicExtraSelectionDisabled(
        { freeTime: true, freeEps0: true, freeEps1: false },
        'freeTime'
      )
    ).toBe(false)
  })
})
