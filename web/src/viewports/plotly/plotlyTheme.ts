const FALLBACK_PANEL = {
  dark: '#353535',
  light: '#ffffff',
}

function readCssVar(name: string): string | null {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') {
    return null
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value.length > 0 ? value : null
}

function detectTheme(): 'light' | 'dark' | null {
  if (typeof document === 'undefined') return null
  const theme = document.documentElement.dataset.theme
  return theme === 'light' || theme === 'dark' ? theme : null
}

export function resolvePlotlyBackgroundColor(): string {
  return (
    readCssVar('--panel') ??
    (detectTheme() === 'light' ? FALLBACK_PANEL.light : FALLBACK_PANEL.dark)
  )
}
