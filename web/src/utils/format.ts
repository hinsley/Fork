/**
 * Shared display formatting for numbers shown in the UI.
 *
 * Rules: 6 significant digits with trailing zeros trimmed, scientific notation
 * outside [1e-4, 1e6), the true minus sign, and exact zero rendered as `0`.
 * Copy/export paths should keep using full precision instead of these helpers.
 */

const MINUS = '−'

function withMinus(text: string): string {
  return text.startsWith('-') ? `${MINUS}${text.slice(1)}` : text
}

function trimMantissa(text: string): string {
  if (!text.includes('.')) return text
  return text.replace(/\.?0+$/, '')
}

function formatExponential(value: number, digits: number): string {
  const [mantissa, exponent] = value.toExponential(Math.max(0, digits - 1)).split('e')
  const exp = Number(exponent)
  return `${trimMantissa(mantissa)}e${exp < 0 ? '-' : ''}${Math.abs(exp)}`
}

export type FormatNumberOptions = {
  /** Significant digits (default 6). */
  digits?: number
  /** Values with magnitude below this are shown as 0 (default: none). */
  zeroBelow?: number
}

/** General-purpose number formatting: `6.28319`, `1.2e-7`, `−0.25`, `0`. */
export function fmt(value: number | null | undefined, options: FormatNumberOptions = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (!Number.isFinite(value)) return value > 0 ? '∞' : `${MINUS}∞`
  const digits = options.digits ?? 6
  if (value === 0 || (options.zeroBelow !== undefined && Math.abs(value) < options.zeroBelow)) {
    return '0'
  }
  const magnitude = Math.abs(value)
  if (magnitude < 1e-4 || magnitude >= 1e6) {
    return withMinus(formatExponential(value, digits))
  }
  const precise = Number(value.toPrecision(digits))
  // toPrecision can itself produce exponent notation for large/small inputs; guard anyway.
  const text = Math.abs(precise) >= 1e6 ? formatExponential(precise, digits) : String(precise)
  return withMinus(text)
}

/** Residuals / tolerances: two significant digits in scientific notation (`7.7e-11`). */
export function fmtSci(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (!Number.isFinite(value)) return value > 0 ? '∞' : `${MINUS}∞`
  if (value === 0) return '0'
  return withMinus(formatExponential(value, digits))
}

/** Integer counts with locale grouping (`10,001`). */
export function fmtCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return Math.trunc(value).toLocaleString('en-US')
}

/** Compact counts (`10k`, `1.2M`). */
export function fmtCompactCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs < 1000) return String(Math.trunc(value))
  if (abs < 1e6) return `${trimMantissa((value / 1000).toFixed(abs < 1e4 ? 1 : 0))}k`
  return `${trimMantissa((value / 1e6).toFixed(abs < 1e7 ? 1 : 0))}M`
}

/** Percentage from a fraction with at most 3 significant digits (`7.11%`). */
export function fmtPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—'
  return `${fmt(fraction * 100, { digits: 3 })}%`
}

export type ComplexLike = { re: number; im: number }

/** Complex number: `−0.25 + 1i`, `3`, `2i`. Imaginary parts below `zeroBelow` are dropped. */
export function fmtComplex(
  value: ComplexLike,
  options: FormatNumberOptions = {}
): string {
  const zeroBelow = options.zeroBelow ?? 1e-12
  const re = Math.abs(value.re) < zeroBelow ? 0 : value.re
  const im = Math.abs(value.im) < zeroBelow ? 0 : value.im
  if (im === 0) return fmt(re, options)
  const imText = `${fmt(Math.abs(im), options)}i`
  if (re === 0) return im < 0 ? `${MINUS}${imText}` : imText
  return `${fmt(re, options)} ${im < 0 ? MINUS : '+'} ${imText}`
}

/**
 * Formats a list of eigenvalues, merging complex-conjugate pairs as `a ± bi`.
 * Returns one string per real value / conjugate pair.
 */
export function fmtEigenvalues(
  values: ComplexLike[],
  options: FormatNumberOptions = {}
): string[] {
  const zeroBelow = options.zeroBelow ?? 1e-12
  const used = new Set<number>()
  const out: string[] = []
  values.forEach((value, index) => {
    if (used.has(index)) return
    used.add(index)
    if (Math.abs(value.im) < zeroBelow) {
      out.push(fmtComplex(value, options))
      return
    }
    const scale = Math.max(1, Math.hypot(value.re, value.im))
    const partner = values.findIndex(
      (candidate, candidateIndex) =>
        !used.has(candidateIndex) &&
        Math.abs(candidate.re - value.re) <= 1e-9 * scale &&
        Math.abs(candidate.im + value.im) <= 1e-9 * scale
    )
    if (partner < 0) {
      out.push(fmtComplex(value, options))
      return
    }
    used.add(partner)
    const re = Math.abs(value.re) < zeroBelow ? 0 : value.re
    const imText = `${fmt(Math.abs(value.im), options)}i`
    out.push(re === 0 ? `±${imText}` : `${fmt(re, options)} ± ${imText}`)
  })
  return out
}

/** Relative time (`just now`, `5 min ago`, `3 h ago`, `2 d ago`), falling back to a date. */
export function fmtRelativeTime(timestamp: string | number | Date | null | undefined, now = Date.now()): string {
  if (timestamp === null || timestamp === undefined) return '—'
  const time = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime()
  if (!Number.isFinite(time)) return '—'
  const seconds = Math.round((now - time) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(time).toISOString().slice(0, 10)
}

/** Durations in milliseconds: `850 ms`, `1.3 s`, `2 min 5 s`. */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${fmt(seconds, { digits: 2 })} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} min ${Math.round(seconds - minutes * 60)} s`
}

/** Closed range `a → b` using `fmt`. */
export function fmtRange(start: number, end: number, options: FormatNumberOptions = {}): string {
  return `${fmt(start, options)} → ${fmt(end, options)}`
}
