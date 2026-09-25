import { useEffect, useState } from 'react'
import { isDeterministicMode } from '../utils/determinism'

export type ResolvedTheme = 'light' | 'dark'
export type ThemePreference = ResolvedTheme | 'system'

const STORAGE_KEY = 'fork-theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Stored preference; first run follows the OS. Deterministic (test) mode pins light. */
export function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined' || isDeterministicMode()) return 'light'
  try {
    const stored = window.localStorage?.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
  return 'system'
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(DARK_QUERY).matches
}

/**
 * Light / Dark / System color scheme. "System" follows `prefers-color-scheme` live.
 * Deterministic (test) mode always starts in light and never persists.
 */
export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(readStoredPreference)
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)

  useEffect(() => {
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(DARK_QUERY)
    const onChange = () => setPrefersDark(query.matches)
    onChange()
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [preference])

  const theme: ResolvedTheme =
    preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (isDeterministicMode()) return
    try {
      window.localStorage?.setItem(STORAGE_KEY, preference)
    } catch {
      // Ignore: the preference simply won't persist.
    }
  }, [preference])

  return { preference, theme, setPreference }
}
