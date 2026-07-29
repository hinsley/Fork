export const DEFAULT_COLOR_OPACITY = 1

export function normalizeColorOpacity(
  value: unknown,
  fallback = DEFAULT_COLOR_OPACITY
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(1, Math.max(0, value))
}

export function colorWithOpacity(color: string, opacity: unknown): string {
  const alpha = normalizeColorOpacity(opacity)
  if (alpha >= 1) return color
  const match = /^#([0-9a-fA-F]{6})$/.exec(color.trim())
  if (!match) return color
  const digits = match[1]
  const red = Number.parseInt(digits.slice(0, 2), 16)
  const green = Number.parseInt(digits.slice(2, 4), 16)
  const blue = Number.parseInt(digits.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function opacityToPercent(opacity: unknown): number {
  return Math.round(normalizeColorOpacity(opacity) * 100)
}

export function percentToOpacity(percent: unknown): number {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) {
    return DEFAULT_COLOR_OPACITY
  }
  return normalizeColorOpacity(percent / 100)
}
