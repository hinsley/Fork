import { describe, expect, it } from 'vitest'
import {
  fmt,
  fmtCompactCount,
  fmtComplex,
  fmtCount,
  fmtDuration,
  fmtEigenvalues,
  fmtPercent,
  fmtRelativeTime,
  fmtSci,
} from './format'

describe('fmt', () => {
  it('trims to 6 significant digits', () => {
    expect(fmt(6.283185307179586)).toBe('6.28319')
    expect(fmt(0.5)).toBe('0.5')
    expect(fmt(100)).toBe('100')
    expect(fmt(0)).toBe('0')
    expect(fmt(-0.25)).toBe('−0.25')
  })

  it('switches to scientific notation outside [1e-4, 1e6)', () => {
    expect(fmt(1.2e-7)).toBe('1.2e-7')
    expect(fmt(2500000)).toBe('2.5e6')
    expect(fmt(-3e-5)).toBe('−3e-5')
  })

  it('handles non-finite values and zero threshold', () => {
    expect(fmt(Number.NaN)).toBe('—')
    expect(fmt(undefined)).toBe('—')
    expect(fmt(Infinity)).toBe('∞')
    expect(fmt(5.9e-17, { zeroBelow: 1e-12 })).toBe('0')
  })
})

describe('other formatters', () => {
  it('formats residuals', () => {
    expect(fmtSci(7.722472e-11)).toBe('7.7e-11')
    expect(fmtSci(1)).toBe('1e0')
    expect(fmtSci(0)).toBe('0')
  })

  it('formats counts', () => {
    expect(fmtCount(10001)).toBe('10,001')
    expect(fmtCompactCount(10001)).toBe('10k')
    expect(fmtCompactCount(1500)).toBe('1.5k')
    expect(fmtCompactCount(999)).toBe('999')
    expect(fmtCompactCount(2_300_000)).toBe('2.3M')
  })

  it('formats percentages', () => {
    expect(fmtPercent(0.0711234)).toBe('7.11%')
    expect(fmtPercent(1)).toBe('100%')
  })

  it('formats complex values', () => {
    expect(fmtComplex({ re: -0.25, im: 1 })).toBe('−0.25 + 1i')
    expect(fmtComplex({ re: 3, im: 0 })).toBe('3')
    expect(fmtComplex({ re: 0, im: -2 })).toBe('−2i')
  })

  it('merges conjugate eigenvalue pairs', () => {
    expect(
      fmtEigenvalues([
        { re: -0.25, im: 1 },
        { re: -0.25, im: -1 },
        { re: 2, im: 0 },
      ])
    ).toEqual(['−0.25 ± 1i', '2'])
    expect(fmtEigenvalues([{ re: 0, im: 1 }, { re: 0, im: -1 }])).toEqual(['±1i'])
  })

  it('formats relative times and durations', () => {
    const now = Date.parse('2026-01-01T12:00:00Z')
    expect(fmtRelativeTime('2026-01-01T11:59:50Z', now)).toBe('just now')
    expect(fmtRelativeTime('2026-01-01T11:55:00Z', now)).toBe('5 min ago')
    expect(fmtRelativeTime('2026-01-01T09:00:00Z', now)).toBe('3 h ago')
    expect(fmtRelativeTime('2025-12-30T12:00:00Z', now)).toBe('2 d ago')
    expect(fmtDuration(850)).toBe('850 ms')
    expect(fmtDuration(1300)).toBe('1.3 s')
  })
})
