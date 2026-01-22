type PlotlyThemeMode = 'light' | 'dark'

export type PlotlyThemeTokens = {
  background: string
  text: string
  muted: string
}

const FALLBACK_TOKENS: Record<PlotlyThemeMode, PlotlyThemeTokens> = {
  dark: {
    background: '#353535',
    text: '#e1e1e1',
    muted: '#b1b1b1',
  },
  light: {
    background: '#ffffff',
    text: '#1a1a1a',
    muted: '#5c5c5c',
  },
}

function readCssVar(name: string): string | null {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
    return null
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value.length > 0 ? value : null
}

function detectTheme(): PlotlyThemeMode | null {
  if (typeof document === 'undefined') return null
  const theme = document.documentElement.dataset.theme
  return theme === 'light' || theme === 'dark' ? theme : null
}

export function resolvePlotlyThemeTokens(theme?: PlotlyThemeMode): PlotlyThemeTokens {
  const resolvedTheme = theme ?? detectTheme() ?? 'dark'
  const fallback = FALLBACK_TOKENS[resolvedTheme]
  const domTheme = detectTheme()
  const canReadCss = !theme || (domTheme !== null && domTheme === resolvedTheme)
  if (!canReadCss) {
    return fallback
  }
  return {
    background: readCssVar('--panel') ?? fallback.background,
    text:
      readCssVar('--plotly-text') ??
      readCssVar('--text') ??
      fallback.text,
    muted:
      readCssVar('--plotly-text-muted') ??
      readCssVar('--text-muted') ??
      fallback.muted,
  }
}

export function resolvePlotlyBackgroundColor(theme?: PlotlyThemeMode): string {
  return resolvePlotlyThemeTokens(theme).background
}

export function resolvePlotlyTextColors(
  theme?: PlotlyThemeMode
): Pick<PlotlyThemeTokens, 'text' | 'muted'> {
  const { text, muted } = resolvePlotlyThemeTokens(theme)
  return { text, muted }
}
